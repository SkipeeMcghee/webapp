import React, { useMemo, useState } from "react";
import Papa from "papaparse";
import { Upload, FileText, BarChart3, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

function safeNumber(value: any, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function parseVision(value: any): { base: number; bonus: number } {
  const s = String(value ?? "");
  const nums = s.match(/-?\d+/g)?.map(Number) ?? [];
  return {
    base: nums[0] ?? 0,
    bonus: nums[1] ?? 0,
  };
}

function parseFuel(value: any): {
  fuelMax: number;
  normalDrain: number;
  specialDrain: number | null;
} {
  const s = String(value ?? "");
  const nums = s.match(/-?\d+/g)?.map(Number) ?? [];
  return {
    fuelMax: nums[0] ?? 0,
    normalDrain: nums[1] ?? 0,
    specialDrain: nums[2] ?? null,
  };
}

function normalizeKey(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripParentheticalName(s: string): string {
  return normalizeKey(String(s ?? "").replace(/\([^)]*\)/g, " "));
}

function tokenSet(s: string): Set<string> {
  return new Set(normalizeKey(s).split(" ").filter(Boolean));
}

function buildUnitAliasMap(units: Array<{ name: string; key: string }>) {
  const aliasToKey = new Map<string, string>();

  const addAlias = (alias: string, key: string) => {
    const normalizedAlias = normalizeKey(alias);
    if (!normalizedAlias) return;
    if (!aliasToKey.has(normalizedAlias)) {
      aliasToKey.set(normalizedAlias, key);
    }
  };

  for (const unit of units) {
    const key = unit.key;
    const tokens = key.split(" ").filter(Boolean);

    addAlias(unit.name, key);
    addAlias(stripParentheticalName(unit.name), key);
    addAlias(key, key);

    if (tokens.length >= 2) {
      const head = tokens.slice(0, -1);
      const tail = tokens[tokens.length - 1];
      const compactInitials = head.map((t) => t[0]).join("");
      addAlias(`${compactInitials} ${tail}`, key);
      if (head.length === 1) {
        addAlias(`${head[0][0]} ${tail}`, key);
      }
    }

    if (key === "battle copter") addAlias("b copter", key);
    if (key === "transport copter") addAlias("t copter", key);
    if (key === "heavy t copter") {
      addAlias("ht copter", key);
      addAlias("h t copter", key);
    }
    if (key === "aircraft carrier") addAlias("carrier", key);
    if (key === "aa missile launcher") addAlias("missiles", key);
    if (key === "rocket launcher") addAlias("rockets", key);
    if (key === "submarine") addAlias("sub", key);
    if (key === "mechanized infantry") addAlias("mech", key);
  }

  return aliasToKey;
}

function resolveUnitKey(rawName: string, aliasToKey: Map<string, string>, unitKeys: string[]) {
  const cleaned = stripParentheticalName(rawName);
  if (!cleaned) return "";

  const direct = aliasToKey.get(cleaned);
  if (direct) return direct;

  for (const unitKey of unitKeys) {
    if (cleaned === unitKey || cleaned.includes(unitKey) || unitKey.includes(cleaned)) {
      return unitKey;
    }
  }

  const sourceTokens = tokenSet(cleaned);
  let bestKey = "";
  let bestScore = 0;

  for (const unitKey of unitKeys) {
    const targetTokens = tokenSet(unitKey);
    const overlap = [...sourceTokens].filter((token) => targetTokens.has(token)).length;
    const score = overlap / Math.max(sourceTokens.size, targetTokens.size, 1);
    if (score > bestScore) {
      bestScore = score;
      bestKey = unitKey;
    }
  }

  return bestScore >= 0.6 ? bestKey : cleaned;
}

function detectColumn(columns: string[], patterns: string[]): string | null {
  const normalized = columns.map((c) => ({ raw: c, key: normalizeKey(c) }));
  for (const pattern of patterns) {
    const hit = normalized.find((c) => c.key === pattern || c.key.includes(pattern));
    if (hit) return hit.raw;
  }
  return null;
}

function firstExisting(row: any, candidates: string[], fallback: any = "") {
  for (const c of candidates) {
    if (row[c] !== undefined) return row[c];
  }
  return fallback;
}

function parseCSV(file: File): Promise<any[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data as any[]),
      error: reject,
    });
  });
}

function scoreAbilities(specialRaw: string) {
  const special = normalizeKey(specialRaw);
  let utility = 0;
  const hits: string[] = [];

  if (special.includes("capture")) {
    utility += 30;
    hits.push("Capture +30");
  }
  if (special.includes("launch")) {
    utility += 20;
    hits.push("Launch +20");
  }
  if (special.includes("supply")) {
    utility += 25;
    hits.push("Supply +25");
  }
  if (special.includes("air supply")) {
    utility += 35;
    hits.push("Air Supply +35");
  }
  if (special.includes("support")) {
    utility += 20;
    hits.push("Support +20");
  }
  if (special.includes("dive")) {
    utility += 25;
    hits.push("Dive +25");
  }
  if (special.includes("excavate")) {
    utility += 15;
    hits.push("Excavate +15");
  }

  return { utility, hits };
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function clamp100(n: number) {
  return Math.max(0, Math.min(100, n));
}

function toPercentScale(value: number, max: number) {
  if (!max || max <= 0) return 0;
  return (value / max) * 100;
}

function analyze(unitsRows: any[], damageRows: any[], terrainRows: any[]) {
  if (!unitsRows.length || !damageRows.length || !terrainRows.length) {
    throw new Error("Please provide all three CSV files.");
  }

  const unitCols = Object.keys(unitsRows[0] ?? {});
  const damageCols = Object.keys(damageRows[0] ?? {});

  const unitNameCol = detectColumn(unitCols, ["name", "unit", "unit name"]) ?? unitCols[0];
  const costCol = detectColumn(unitCols, ["cost"]);
  const moveCol = detectColumn(unitCols, ["move"]);
  const fuelCol = detectColumn(unitCols, ["fuel"]);
  const visionCol = detectColumn(unitCols, ["vision"]);
  const specialCol = detectColumn(unitCols, ["special", "ability", "abilities", "command", "commands"]);
  const weapon1RangeCol = detectColumn(unitCols, ["weapon 1 range", "weapon1 range", "range 1", "weapon range"]);
  const weapon2RangeCol = detectColumn(unitCols, ["weapon 2 range", "weapon2 range", "range 2"]);
  const ammo1Col = detectColumn(unitCols, ["weapon 1 ammo", "weapon1 ammo", "ammo 1", "ammo"]);
  const ammo2Col = detectColumn(unitCols, ["weapon 2 ammo", "weapon2 ammo", "ammo 2"]);

  const damageRowNameCol = damageCols[0];
  const defenderCols = damageCols.slice(1);

  const units = unitsRows.map((row) => {
    const name = String(row[unitNameCol] ?? "").trim();
    const cost = safeNumber(costCol ? row[costCol] : 0);
    const move = safeNumber(moveCol ? row[moveCol] : 0);
    const fuel = parseFuel(fuelCol ? row[fuelCol] : "");
    const vision = parseVision(visionCol ? row[visionCol] : 0);
    const special = String(specialCol ? row[specialCol] ?? "" : "");
    const abilityScore = scoreAbilities(special);
    const weapon1Range = safeNumber(weapon1RangeCol ? row[weapon1RangeCol] : 1, 1);
    const weapon2Range = safeNumber(weapon2RangeCol ? row[weapon2RangeCol] : 0, 0);
    const ammo1 = safeNumber(ammo1Col ? row[ammo1Col] : 0);
    const ammo2 = safeNumber(ammo2Col ? row[ammo2Col] : 0);

    return {
      row,
      name,
      key: normalizeKey(name),
      cost,
      move,
      fuel,
      vision,
      special,
      abilityScore,
      weapon1Range,
      weapon2Range,
      ammo1,
      ammo2,
    };
  }).filter((u) => u.name);

  const unitKeys = units.map((u) => u.key);
  const aliasToKey = buildUnitAliasMap(units);

  const unitByKey = new Map(units.map((u) => [u.key, u]));
  const unresolvedDefenders = new Set<string>();
  const unresolvedAttackers = new Set<string>();

  const defenders = defenderCols.map((c) => {
    const resolvedKey = resolveUnitKey(c, aliasToKey, unitKeys);
    if (!unitByKey.has(resolvedKey)) {
      unresolvedDefenders.add(String(c));
    }
    return {
      raw: c,
      key: resolvedKey,
      cost: unitByKey.get(resolvedKey)?.cost ?? 0,
    };
  });

  const damageMap = new Map<string, Map<string, number>>();

  for (const row of damageRows) {
    const attackerName = String(row[damageRowNameCol] ?? "").trim();
    const attackerKey = resolveUnitKey(attackerName, aliasToKey, unitKeys);
    if (!attackerKey) continue;
    if (!unitByKey.has(attackerKey)) {
      unresolvedAttackers.add(attackerName);
      continue;
    }

    let inner = damageMap.get(attackerKey);
    if (!inner) {
      inner = new Map<string, number>();
      damageMap.set(attackerKey, inner);
    }

    for (const def of defenders) {
      const val = row[def.raw];
      const dmg = val === "-" ? 0 : safeNumber(val, 0);
      const prev = inner.get(def.key) ?? 0;
      if (dmg > prev) inner.set(def.key, dmg);
    }
  }

  const rows = units.map((u) => {
    const rowDamage = damageMap.get(u.key) ?? new Map<string, number>();
    const damages = defenders.map((d) => rowDamage.get(d.key) ?? 0);
    const positiveDamages = defenders
      .map((d) => ({ dmg: rowDamage.get(d.key) ?? 0, cost: d.cost, key: d.key }))
      .filter((x) => x.dmg > 0);

    const avgDamage = average(positiveDamages.map((x) => x.dmg));

    const weightedDenom = positiveDamages.reduce((sum, x) => sum + Math.max(x.cost, 1), 0);
    const weightedNumer = positiveDamages.reduce((sum, x) => sum + (x.dmg / 100) * Math.max(x.cost, 1), 0);
    const costWeightedDamage = weightedDenom > 0 ? (weightedNumer / weightedDenom) * 100 : 0;

    const incomingHits = units.map((other) => {
      const otherMap = damageMap.get(other.key) ?? new Map<string, number>();
      return otherMap.get(u.key) ?? 0;
    }).filter((n) => n > 0);

    const avgIncoming = average(incomingHits);
    const durabilityRaw = avgIncoming > 0 ? 100 - avgIncoming : 100;

    const direct = u.weapon1Range <= 1 || (u.weapon1Range === 0 && u.weapon2Range <= 1 && u.weapon2Range > 0);
    const maxRange = Math.max(u.weapon1Range, u.weapon2Range, 1);
    const indirect = maxRange > 1;

    let setupTax = 0;
    if (indirect) {
      if (maxRange <= 3) setupTax = 1.5;
      else if (maxRange <= 5) setupTax = 2;
      else setupTax = 2.25;
    }

    const threatRaw = u.move + maxRange - setupTax;

    const returnFirePenalty = direct ? avgIncoming * 0.85 : 0;
    const setupModifier = indirect ? (maxRange <= 3 ? 0.88 : maxRange <= 5 ? 0.83 : 0.8) : 1;
    const combatExchangeRaw = Math.max(0, (costWeightedDamage * setupModifier) - returnFirePenalty);

    const turnEndurance = u.fuel.normalDrain > 0 ? u.fuel.fuelMax / u.fuel.normalDrain : u.fuel.fuelMax;
    const movementBudget = u.move * (turnEndurance || 0);
    const enduranceRaw = average([turnEndurance, movementBudget / 10]);

    const fogVisionRaw = u.vision.base + u.vision.bonus * 0.5;

    const ammoFlexRaw = average([
      u.ammo1 > 0 ? Math.min(u.ammo1, 9) : 0,
      u.ammo2 > 0 ? Math.min(u.ammo2, 9) : 0,
    ]);

    const utilityRaw = u.abilityScore.utility + ammoFlexRaw;

    let role = "Frontline";
    if (indirect) role = "Indirect";
    if (/capture|launch/.test(normalizeKey(u.special))) role = "Objective";
    if (/supply|air supply|support|excavate|dive/.test(normalizeKey(u.special))) role = "Support";

    return {
      unit: u.name,
      role,
      cost: u.cost,
      move: u.move,
      range: maxRange,
      direct: direct ? "Yes" : "No",
      avgDamage,
      costWeightedDamage,
      avgIncoming,
      combatExchangeRaw,
      durabilityRaw,
      threatRaw,
      enduranceTurns: turnEndurance,
      movementBudget,
      enduranceRaw,
      fogVisionRaw,
      utilityRaw,
      special: u.special || "—",
      utilityNotes: u.abilityScore.hits.join(", ") || "—",
    };
  });

  const numericCols = [
    "combatExchangeRaw",
    "durabilityRaw",
    "threatRaw",
    "enduranceRaw",
    "fogVisionRaw",
    "utilityRaw",
  ] as const;

  const maxima = Object.fromEntries(
    numericCols.map((col) => [col, Math.max(...rows.map((r) => r[col]), 0)])
  ) as Record<(typeof numericCols)[number], number>;

  const scored = rows.map((r) => {
    const combat = toPercentScale(r.combatExchangeRaw, maxima.combatExchangeRaw);
    const durability = toPercentScale(r.durabilityRaw, maxima.durabilityRaw);
    const threat = toPercentScale(r.threatRaw, maxima.threatRaw);
    const endurance = toPercentScale(r.enduranceRaw, maxima.enduranceRaw);
    const vision = toPercentScale(r.fogVisionRaw, maxima.fogVisionRaw);
    const utility = toPercentScale(r.utilityRaw, maxima.utilityRaw);

    let weights = {
      combat: 0.5,
      threat: 0.2,
      endurance: 0.1,
      vision: 0.05,
      utility: 0.15,
    };

    if (r.role === "Indirect") {
      weights = { combat: 0.45, threat: 0.3, endurance: 0.1, vision: 0.05, utility: 0.1 };
    } else if (r.role === "Objective") {
      weights = { combat: 0.35, threat: 0.15, endurance: 0.1, vision: 0.05, utility: 0.35 };
    } else if (r.role === "Support") {
      weights = { combat: 0.2, threat: 0.15, endurance: 0.15, vision: 0.1, utility: 0.4 };
    }

    const total =
      combat * weights.combat +
      threat * weights.threat +
      endurance * weights.endurance +
      vision * weights.vision +
      utility * weights.utility;

    return {
      ...r,
      combat: clamp100(combat),
      durability: clamp100(durability),
      threat: clamp100(threat),
      endurance: clamp100(endurance),
      vision: clamp100(vision),
      utility: clamp100(utility),
      total: clamp100(total),
      weights,
    };
  });

  const sorted = [...scored].sort((a, b) => b.total - a.total);

  const summary = {
    top5: sorted.slice(0, 5),
    bottom5: [...sorted].slice(-5).reverse(),
    biggestCombat: [...sorted].sort((a, b) => b.combat - a.combat).slice(0, 5),
    biggestUtility: [...sorted].sort((a, b) => b.utility - a.utility).slice(0, 5),
  };

  return {
    rows: sorted,
    summary,
    meta: {
      units: units.length,
      terrainRows: terrainRows.length,
      damageRows: damageRows.length,
      unresolvedAttackers: [...unresolvedAttackers],
      unresolvedDefenders: [...unresolvedDefenders],
    },
  };
}

function FileDropBox({
  label,
  accept,
  file,
  onFile,
}: {
  label: string;
  accept: string;
  file: File | null;
  onFile: (file: File | null) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) onFile(dropped);
      }}
      className={`rounded-3xl border-2 border-dashed p-6 transition ${dragOver ? "border-black bg-black/5" : "border-zinc-300 bg-white"}`}
    >
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-zinc-100 p-3">
          <Upload className="h-5 w-5" />
        </div>
        <div>
          <div className="font-medium">{label}</div>
          <div className="text-sm text-zinc-500">Drag a CSV here or choose a file.</div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <input
          type="file"
          accept={accept}
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
      </div>
      {file && (
        <div className="mt-4 flex items-center gap-2 text-sm text-zinc-700">
          <FileText className="h-4 w-4" />
          <span>{file.name}</span>
        </div>
      )}
    </div>
  );
}

export default function CsvBalanceAnalyzerWebapp() {
  const [unitsFile, setUnitsFile] = useState<File | null>(null);
  const [terrainFile, setTerrainFile] = useState<File | null>(null);
  const [damageFile, setDamageFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<any | null>(null);

  const canAnalyze = useMemo(() => !!unitsFile && !!terrainFile && !!damageFile, [unitsFile, terrainFile, damageFile]);

  async function runAnalysis() {
    if (!unitsFile || !terrainFile || !damageFile) return;
    setLoading(true);
    setError("");
    try {
      const [unitsRows, terrainRows, damageRows] = await Promise.all([
        parseCSV(unitsFile),
        parseCSV(terrainFile),
        parseCSV(damageFile),
      ]);
      const analyzed = analyze(unitsRows, damageRows, terrainRows);
      setResult(analyzed);
    } catch (e: any) {
      setError(e?.message || "Failed to analyze files.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function renderSummary(r: any) {
    const lines = [];
    lines.push(`Loaded ${r.meta.units} units, ${r.meta.terrainRows} terrain rows, and ${r.meta.damageRows} damage rows.`);
    if ((r.meta.unresolvedAttackers?.length ?? 0) > 0 || (r.meta.unresolvedDefenders?.length ?? 0) > 0) {
      lines.push(`Unresolved labels: attackers ${r.meta.unresolvedAttackers.length}, defenders ${r.meta.unresolvedDefenders.length}.`);
      if (r.meta.unresolvedAttackers.length > 0) {
        lines.push(`  Attackers: ${r.meta.unresolvedAttackers.slice(0, 8).join(", ")}`);
      }
      if (r.meta.unresolvedDefenders.length > 0) {
        lines.push(`  Defenders: ${r.meta.unresolvedDefenders.slice(0, 8).join(", ")}`);
      }
    }
    lines.push("");
    lines.push("Top 5 total-score units:");
    r.summary.top5.forEach((u: any, i: number) => {
      lines.push(`${i + 1}. ${u.unit} — total ${u.total.toFixed(1)}, combat ${u.combat.toFixed(1)}, threat ${u.threat.toFixed(1)}, endurance ${u.endurance.toFixed(1)}, vision ${u.vision.toFixed(1)}, utility ${u.utility.toFixed(1)}.`);
    });
    lines.push("");
    lines.push("Top 5 combat-exchange units:");
    r.summary.biggestCombat.forEach((u: any, i: number) => {
      lines.push(`${i + 1}. ${u.unit} — combat ${u.combat.toFixed(1)}, cost-weighted damage ${u.costWeightedDamage.toFixed(1)}, avg incoming ${u.avgIncoming.toFixed(1)}.`);
    });
    lines.push("");
    lines.push("Top 5 utility units:");
    r.summary.biggestUtility.forEach((u: any, i: number) => {
      lines.push(`${i + 1}. ${u.unit} — utility ${u.utility.toFixed(1)}, notes: ${u.utilityNotes}.`);
    });
    lines.push("");
    lines.push("Bottom 5 total-score units:");
    r.summary.bottom5.forEach((u: any, i: number) => {
      lines.push(`${i + 1}. ${u.unit} — total ${u.total.toFixed(1)}.`);
    });
    return lines.join("\n");
  }

  return (
    <div className="min-h-screen bg-zinc-50 p-6 md:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">CSV Balance Analyzer</h1>
          <p className="max-w-3xl text-zinc-600">
            Drop in Units, Terrain, and Damage CSV files to run a procedural scoring pass for combat exchange,
            threat projection, endurance, fog vision, and utility. Results render directly in the browser.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <FileDropBox label="Units.csv" accept=".csv,text/csv" file={unitsFile} onFile={setUnitsFile} />
          <FileDropBox label="Terrain.csv" accept=".csv,text/csv" file={terrainFile} onFile={setTerrainFile} />
          <FileDropBox label="Damage.csv" accept=".csv,text/csv" file={damageFile} onFile={setDamageFile} />
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={runAnalysis} disabled={!canAnalyze || loading} className="rounded-2xl px-6">
            <BarChart3 className="mr-2 h-4 w-4" />
            {loading ? "Analyzing..." : "Run Analysis"}
          </Button>
          {result && <Badge variant="secondary" className="rounded-full px-3 py-1">Analysis complete</Badge>}
        </div>

        {error && (
          <Card className="rounded-3xl border-red-200 bg-red-50">
            <CardContent className="flex items-start gap-3 p-6 text-red-900">
              <AlertCircle className="mt-0.5 h-5 w-5" />
              <div>{error}</div>
            </CardContent>
          </Card>
        )}

        {result && (
          <div className="grid gap-6 xl:grid-cols-[1.1fr_1.4fr]">
            <Card className="rounded-3xl">
              <CardHeader>
                <CardTitle>Readable Output</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea value={renderSummary(result)} readOnly className="min-h-[520px] resize-none rounded-2xl font-mono text-sm" />
              </CardContent>
            </Card>

            <Card className="rounded-3xl">
              <CardHeader>
                <CardTitle>Unit Scores</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-[720px] overflow-auto rounded-2xl border">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b text-left">
                        <th className="px-3 py-3">Unit</th>
                        <th className="px-3 py-3">Role</th>
                        <th className="px-3 py-3">Combat</th>
                        <th className="px-3 py-3">Durability</th>
                        <th className="px-3 py-3">Threat</th>
                        <th className="px-3 py-3">Endurance</th>
                        <th className="px-3 py-3">Vision</th>
                        <th className="px-3 py-3">Utility</th>
                        <th className="px-3 py-3">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row: any) => (
                        <tr key={row.unit} className="border-b align-top">
                          <td className="px-3 py-3 font-medium">{row.unit}</td>
                          <td className="px-3 py-3 text-zinc-600">{row.role}</td>
                          <td className="px-3 py-3">{row.combat.toFixed(1)}</td>
                          <td className="px-3 py-3">{row.durability.toFixed(1)}</td>
                          <td className="px-3 py-3">{row.threat.toFixed(1)}</td>
                          <td className="px-3 py-3">{row.endurance.toFixed(1)}</td>
                          <td className="px-3 py-3">{row.vision.toFixed(1)}</td>
                          <td className="px-3 py-3">{row.utility.toFixed(1)}</td>
                          <td className="px-3 py-3 font-semibold">{row.total.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
