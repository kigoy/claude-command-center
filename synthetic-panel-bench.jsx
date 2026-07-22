import React, { useRef, useState } from "react";

// Synthetic Panel Validation Bench — v2
//
// Benchmarks how well an LLM-simulated respondent panel reproduces known human
// survey shares. v2 adds: per-respondent mode with census-sampled personas,
// 5 repetitions per study with 95% CI error bars, bootstrap CI on Pearson r,
// CSV export, and a temperature control.
//
// Constraints honored: no localStorage, no <form> tags, Tailwind core classes
// only (palette hexes applied via inline style), IBM Plex Mono for data.

// ---------------------------------------------------------------------------
// Pure logic (no JSX above the COMPONENT marker — kept extractable for tests)
// ---------------------------------------------------------------------------

export const PALETTE = { bg: "#E8EBE9", ink: "#131C24", accent: "#E0A400" };
export const REPS = 5;
export const PASS_MARGIN_PTS = 10;

// Human benchmarks are approximate national shares from recent GSS/Pew waves;
// the bench measures recovery of the pattern, not the exact point estimates.
export const STUDIES = [
  { id: "death-penalty", label: "Death penalty (favor)", question: "Do you favor or oppose the death penalty for persons convicted of murder?", options: ["Favor", "Oppose"], target: "Favor", human_pct: 53 },
  { id: "marijuana", label: "Marijuana legalization (support)", question: "Do you think the use of marijuana should be made legal, or not?", options: ["Legal", "Not legal"], target: "Legal", human_pct: 68 },
  { id: "same-sex-marriage", label: "Same-sex marriage (support)", question: "Do you think marriages between same-sex couples should or should not be recognized by the law as valid?", options: ["Should be valid", "Should not be valid"], target: "Should be valid", human_pct: 71 },
  { id: "gun-laws", label: "Stricter gun laws (favor)", question: "In general, do you favor stricter gun laws in the United States, or not?", options: ["Favor stricter", "Do not favor stricter"], target: "Favor stricter", human_pct: 58 },
  { id: "abortion", label: "Abortion legal (all/most cases)", question: "Should abortion be legal in all or most cases, or illegal in all or most cases?", options: ["Legal in all or most cases", "Illegal in all or most cases"], target: "Legal in all or most cases", human_pct: 61 },
  { id: "climate", label: "Climate change (human activity)", question: "Do you believe the Earth is warming mostly because of human activity, or mostly because of natural patterns?", options: ["Human activity", "Natural patterns"], target: "Human activity", human_pct: 57 },
  { id: "govt-role", label: "Government should do more", question: "Would you say the government should do more to solve problems, or that the government is doing too many things better left to businesses and individuals?", options: ["Should do more", "Doing too much"], target: "Should do more", human_pct: 52 },
  { id: "immigration", label: "Immigration strengthens US", question: "Do immigrants today strengthen the country through their hard work and talents, or are they a burden on the country?", options: ["Strengthen", "Burden"], target: "Strengthen", human_pct: 64 },
];

// US adult marginals, approximated from ACS / Census CPS distributions.
export const CENSUS_MARGINALS = {
  age: [["18-29", 0.21], ["30-44", 0.25], ["45-64", 0.33], ["65 or older", 0.21]],
  gender: [["a woman", 0.51], ["a man", 0.49]],
  education: [["a high school education or less", 0.38], ["some college", 0.26], ["a bachelor's degree", 0.23], ["a graduate degree", 0.13]],
  income: [["under $35,000", 0.26], ["$35,000-$75,000", 0.30], ["$75,000-$150,000", 0.29], ["over $150,000", 0.15]],
  region: [["the Northeast", 0.17], ["the Midwest", 0.21], ["the South", 0.38], ["the West", 0.24]],
};

export function sampleFrom(dist, rng) {
  const roll = rng();
  let cum = 0;
  for (const [value, p] of dist) {
    cum += p;
    if (roll < cum) return value;
  }
  return dist[dist.length - 1][0];
}

export function samplePersona(rng) {
  return {
    age: sampleFrom(CENSUS_MARGINALS.age, rng),
    gender: sampleFrom(CENSUS_MARGINALS.gender, rng),
    education: sampleFrom(CENSUS_MARGINALS.education, rng),
    income: sampleFrom(CENSUS_MARGINALS.income, rng),
    region: sampleFrom(CENSUS_MARGINALS.region, rng),
  };
}

export function personaPrompt(study, persona) {
  return [
    `You are simulating one survey respondent: ${persona.gender}, aged ${persona.age}, with ${persona.education}, household income ${persona.income}, living in ${persona.region} of the United States.`,
    `Answer the following survey question the way this specific person most plausibly would. Do not answer as an AI; answer in character.`,
    `Question: ${study.question}`,
    `Options: ${study.options.join(" | ")}`,
    `Respond with ONLY valid JSON, no other text: {"answer": "<one option, copied exactly>"}`,
  ].join("\n");
}

export function batchPrompt(study, panelSize) {
  return [
    `Simulate a demographically representative panel of exactly ${panelSize} US adults (matching US census marginals for age, gender, education, income, and region) answering this survey question:`,
    `Question: ${study.question}`,
    `Options: ${study.options.join(" | ")}`,
    `Respond with ONLY valid JSON, no other text: {"counts": {${study.options.map((o) => `"${o}": <integer>`).join(", ")}}}`,
    `The counts MUST sum to exactly ${panelSize}.`,
  ].join("\n");
}

export function extractJSON(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export function matchOption(answer, options) {
  if (typeof answer !== "string") return null;
  const norm = answer.trim().toLowerCase();
  return options.find((o) => o.toLowerCase() === norm) || options.find((o) => norm.includes(o.toLowerCase())) || null;
}

// Guard: counts must cover exactly the study options and sum to the panel size.
export function validateCounts(counts, options, panelSize) {
  if (!counts || typeof counts !== "object") throw new Error("No counts object in response");
  let sum = 0;
  for (const o of options) {
    const n = counts[o];
    if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid count for "${o}": ${n}`);
    sum += n;
  }
  if (sum !== panelSize) throw new Error(`Counts sum to ${sum}, expected panel size ${panelSize}`);
  return counts;
}

export function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function sd(xs) {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
}

// 95% CI on the mean of the repetition shares, t(4) = 2.776 for REPS = 5.
export function meanCI95(shares) {
  const m = mean(shares);
  if (shares.length < 2) return { mean: m, lo: m, hi: m };
  const tCrit = { 2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776 }[shares.length] || 1.96;
  const half = tCrit * sd(shares) / Math.sqrt(shares.length);
  return { mean: m, lo: Math.max(0, m - half), hi: Math.min(100, m + half) };
}

export function pearson(xs, ys) {
  const n = xs.length;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

// Percentile bootstrap over study-level (human, synthetic) pairs.
export function bootstrapPearsonCI(pairs, iters, rng) {
  if (pairs.length < 3) return null;
  const rs = [];
  for (let i = 0; i < iters; i++) {
    const xs = [], ys = [];
    for (let j = 0; j < pairs.length; j++) {
      const p = pairs[Math.floor(rng() * pairs.length)];
      xs.push(p[0]);
      ys.push(p[1]);
    }
    rs.push(pearson(xs, ys));
  }
  rs.sort((a, b) => a - b);
  return { lo: rs[Math.floor(iters * 0.025)], hi: rs[Math.min(iters - 1, Math.floor(iters * 0.975))] };
}

export function buildCSV(results) {
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [["study", "human_pct", "synthetic_mean", "ci_low", "ci_high", "pass"]];
  for (const r of results) {
    rows.push([r.label, r.human_pct, r.mean.toFixed(2), r.lo.toFixed(2), r.hi.toFixed(2), r.pass ? "TRUE" : "FALSE"]);
  }
  return rows.map((row) => row.map(esc).join(",")).join("\n");
}

// One repetition in batch mode: a single call returns the whole panel's counts.
export async function runBatchRep(study, panelSize, callModel, onCall) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await callModel(batchPrompt(study, panelSize));
    if (onCall) onCall(1);
    const parsed = extractJSON(text);
    try {
      return validateCounts(parsed && parsed.counts, study.options, panelSize);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Batch rep failed after 3 attempts: ${lastErr && lastErr.message}`);
}

// One repetition in per-respondent mode: panelSize independent calls, each with
// a freshly sampled census persona. Runs in small concurrent chunks.
export async function runPerRespondentRep(study, panelSize, callModel, onCall, rng) {
  const counts = Object.fromEntries(study.options.map((o) => [o, 0]));
  const askOne = async () => {
    const prompt = personaPrompt(study, samplePersona(rng));
    for (let attempt = 0; attempt < 3; attempt++) {
      const text = await callModel(prompt);
      if (onCall) onCall(1);
      const parsed = extractJSON(text);
      const choice = matchOption(parsed && parsed.answer, study.options);
      if (choice) return choice;
    }
    throw new Error("Respondent gave no valid option after 3 attempts");
  };
  const CHUNK = 4;
  for (let done = 0; done < panelSize; done += CHUNK) {
    const n = Math.min(CHUNK, panelSize - done);
    const answers = await Promise.all(Array.from({ length: n }, askOne));
    for (const a of answers) counts[a] += 1;
  }
  return validateCounts(counts, study.options, panelSize);
}

// Full study: REPS repetitions -> mean share, 95% CI, pass verdict.
export async function runStudy(study, { mode, panelSize, callModel, onCall, rng }) {
  const shares = [];
  for (let rep = 0; rep < REPS; rep++) {
    const counts = mode === "per-respondent"
      ? await runPerRespondentRep(study, panelSize, callModel, onCall, rng)
      : await runBatchRep(study, panelSize, callModel, onCall);
    shares.push((counts[study.target] / panelSize) * 100);
  }
  const ci = meanCI95(shares);
  return {
    id: study.id,
    label: study.label,
    human_pct: study.human_pct,
    shares,
    mean: ci.mean,
    lo: ci.lo,
    hi: ci.hi,
    pass: Math.abs(ci.mean - study.human_pct) <= PASS_MARGIN_PTS,
  };
}

export function callsPerStudy(mode, panelSize) {
  return REPS * (mode === "per-respondent" ? panelSize : 1);
}

export function makeClaudeCaller(temperature) {
  return async (prompt) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 400,
        temperature,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    return data.content.map((b) => b.text || "").join("");
  };
}

// ------------------------------- COMPONENT ---------------------------------

const MONO = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

function Scatter({ results }) {
  const W = 460, H = 460, PAD = 48;
  const sx = (v) => PAD + (v / 100) * (W - 2 * PAD);
  const sy = (v) => H - PAD - (v / 100) * (H - 2 * PAD);
  const ticks = [0, 25, 50, 75, 100];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-lg" role="img" aria-label="Human vs synthetic shares">
      <rect x="0" y="0" width={W} height={H} fill="white" opacity="0.5" rx="8" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={sx(t)} y1={sy(0)} x2={sx(t)} y2={sy(100)} stroke={PALETTE.ink} strokeOpacity="0.12" />
          <line x1={sx(0)} y1={sy(t)} x2={sx(100)} y2={sy(t)} stroke={PALETTE.ink} strokeOpacity="0.12" />
          <text x={sx(t)} y={H - PAD + 18} textAnchor="middle" fontSize="10" fill={PALETTE.ink} style={MONO}>{t}</text>
          <text x={PAD - 8} y={sy(t) + 3} textAnchor="end" fontSize="10" fill={PALETTE.ink} style={MONO}>{t}</text>
        </g>
      ))}
      <line x1={sx(0)} y1={sy(0)} x2={sx(100)} y2={sy(100)} stroke={PALETTE.ink} strokeOpacity="0.45" strokeDasharray="5 4" />
      {results.map((r) => (
        <g key={r.id}>
          <line x1={sx(r.human_pct)} y1={sy(r.lo)} x2={sx(r.human_pct)} y2={sy(r.hi)} stroke={r.pass ? PALETTE.ink : PALETTE.accent} strokeWidth="2" />
          <line x1={sx(r.human_pct) - 4} y1={sy(r.lo)} x2={sx(r.human_pct) + 4} y2={sy(r.lo)} stroke={r.pass ? PALETTE.ink : PALETTE.accent} strokeWidth="2" />
          <line x1={sx(r.human_pct) - 4} y1={sy(r.hi)} x2={sx(r.human_pct) + 4} y2={sy(r.hi)} stroke={r.pass ? PALETTE.ink : PALETTE.accent} strokeWidth="2" />
          <circle cx={sx(r.human_pct)} cy={sy(r.mean)} r="5" fill={r.pass ? PALETTE.ink : PALETTE.accent} stroke="white" strokeWidth="1.5">
            <title>{`${r.label}: human ${r.human_pct}%, synthetic ${r.mean.toFixed(1)}% [${r.lo.toFixed(1)}, ${r.hi.toFixed(1)}]`}</title>
          </circle>
        </g>
      ))}
      <text x={W / 2} y={H - 10} textAnchor="middle" fontSize="11" fill={PALETTE.ink} style={MONO}>human share (%)</text>
      <text x={14} y={H / 2} textAnchor="middle" fontSize="11" fill={PALETTE.ink} style={MONO} transform={`rotate(-90 14 ${H / 2})`}>synthetic mean (%)</text>
    </svg>
  );
}

export default function SyntheticPanelBench() {
  const [mode, setMode] = useState("batch");
  const [temperature, setTemperature] = useState(0.7);
  const [panelSize, setPanelSize] = useState(20);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [results, setResults] = useState([]);
  const [errors, setErrors] = useState([]);
  const cancelRef = useRef(false);

  const finished = results.filter((r) => r && !r.error);
  const pairs = finished.map((r) => [r.human_pct, r.mean]);
  const r = pairs.length >= 3 ? pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1])) : null;
  const rCI = pairs.length >= 3 ? bootstrapPearsonCI(pairs, 2000, Math.random) : null;

  const runAll = async () => {
    setRunning(true);
    setResults([]);
    setErrors([]);
    cancelRef.current = false;
    const callModel = makeClaudeCaller(temperature);
    const total = STUDIES.length * callsPerStudy(mode, panelSize);
    let done = 0;
    setProgress({ done, total, label: "" });
    const out = [];
    for (const study of STUDIES) {
      if (cancelRef.current) break;
      setProgress((p) => ({ ...p, label: study.label }));
      try {
        const res = await runStudy(study, {
          mode,
          panelSize,
          callModel,
          rng: Math.random,
          onCall: (n) => {
            done += n;
            setProgress((p) => ({ ...p, done }));
          },
        });
        out.push(res);
        setResults([...out]);
      } catch (err) {
        setErrors((e) => [...e, `${study.label}: ${err.message}`]);
      }
    }
    setRunning(false);
  };

  const exportCSV = () => {
    const blob = new Blob([buildCSV(finished)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "synthetic-panel-bench.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: PALETTE.bg, color: PALETTE.ink }}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Synthetic Panel Validation Bench <span style={{ color: PALETTE.accent }}>v2</span></h1>
          <p className="text-sm opacity-70 mt-1">
            {STUDIES.length} studies x {REPS} repetitions - pass if |synthetic - human| &le; {PASS_MARGIN_PTS} pts
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-6">
          <div>
            <div className="text-xs uppercase tracking-wide opacity-60 mb-1">Mode</div>
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: PALETTE.ink }}>
              {[["batch", "Batch panel"], ["per-respondent", "Per-respondent"]].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => !running && setMode(value)}
                  className="px-3 py-1.5 text-sm"
                  style={mode === value ? { backgroundColor: PALETTE.ink, color: PALETTE.bg } : { backgroundColor: "transparent", color: PALETTE.ink }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="text-xs opacity-60 mt-1">
              {mode === "per-respondent" ? `${panelSize} calls/rep, randomized census personas` : "1 call/rep returns full panel counts"}
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide opacity-60 mb-1">Temperature <span style={MONO}>{temperature.toFixed(1)}</span></div>
            <input
              type="range" min="0" max="1" step="0.1" value={temperature}
              disabled={running}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-40 accent-current"
            />
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide opacity-60 mb-1">Panel size</div>
            <input
              type="number" min="4" max="100" value={panelSize}
              disabled={running}
              onChange={(e) => setPanelSize(Math.max(4, Math.min(100, parseInt(e.target.value, 10) || 20)))}
              className="w-24 px-2 py-1.5 rounded-lg border bg-transparent text-sm"
              style={{ ...MONO, borderColor: PALETTE.ink }}
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={running ? () => { cancelRef.current = true; } : runAll}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: running ? PALETTE.accent : PALETTE.ink, color: running ? PALETTE.ink : PALETTE.bg }}
            >
              {running ? "Cancel" : "Run bench"}
            </button>
            <button
              onClick={exportCSV}
              disabled={running || finished.length === 0}
              className="px-4 py-2 rounded-lg text-sm font-semibold border disabled:opacity-40"
              style={{ borderColor: PALETTE.ink, color: PALETTE.ink }}
            >
              Export CSV
            </button>
          </div>
        </div>

        {running && (
          <div>
            <div className="text-sm mb-1" style={MONO}>
              {progress.label} - {progress.done}/{progress.total} calls
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(19,28,36,0.15)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, backgroundColor: PALETTE.accent }} />
            </div>
          </div>
        )}

        {errors.map((e, i) => (
          <div key={i} className="text-sm px-3 py-2 rounded-lg" style={{ backgroundColor: "rgba(224,164,0,0.2)", ...MONO }}>{e}</div>
        ))}

        {finished.length > 0 && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <Scatter results={finished} />
              <div className="text-sm mt-2" style={MONO}>
                {r !== null && (
                  <>
                    Pearson r = {r.toFixed(3)}
                    {rCI && <> &nbsp; 95% bootstrap CI [{rCI.lo.toFixed(3)}, {rCI.hi.toFixed(3)}]</>}
                  </>
                )}
                {r === null && "Need >= 3 completed studies for r"}
              </div>
              <div className="flex gap-4 text-xs mt-1 opacity-70">
                <span><span className="inline-block w-2.5 h-2.5 rounded-full mr-1" style={{ backgroundColor: PALETTE.ink }} />pass</span>
                <span><span className="inline-block w-2.5 h-2.5 rounded-full mr-1" style={{ backgroundColor: PALETTE.accent }} />fail</span>
                <span>error bars: 95% CI over {REPS} reps</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={MONO}>
                <thead>
                  <tr className="text-left border-b" style={{ borderColor: PALETTE.ink }}>
                    <th className="py-2 pr-3">study</th>
                    <th className="py-2 pr-3 text-right">human</th>
                    <th className="py-2 pr-3 text-right">synth</th>
                    <th className="py-2 pr-3 text-right">95% CI</th>
                    <th className="py-2">pass</th>
                  </tr>
                </thead>
                <tbody>
                  {finished.map((row) => (
                    <tr key={row.id} className="border-b" style={{ borderColor: "rgba(19,28,36,0.15)" }}>
                      <td className="py-2 pr-3">{row.label}</td>
                      <td className="py-2 pr-3 text-right">{row.human_pct.toFixed(0)}</td>
                      <td className="py-2 pr-3 text-right">{row.mean.toFixed(1)}</td>
                      <td className="py-2 pr-3 text-right">[{row.lo.toFixed(1)}, {row.hi.toFixed(1)}]</td>
                      <td className="py-2 font-bold" style={{ color: row.pass ? PALETTE.ink : PALETTE.accent }}>{row.pass ? "PASS" : "FAIL"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
