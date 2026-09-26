// Generates the demo patients' files: synthetic SVG documents in public/documents/<patient-id>/
// and their metadata in src/constants/mock-documents.ts. Every file only restates what is already
// in that patient's record (src/constants/mock-api-patients.ts); nothing here is real patient data.
// Re-run after changing the list below:
//
//     cd website && node scripts/generate_mock_documents.mjs && npx oxfmt --write src/constants/mock-documents.ts

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 480;
const H = 640;
const FONT = `font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"`;

// ---------- Documents, newest first per patient ----------

const PATIENTS = [
  {
    id: '5f8b2a3c-9e1d-4c67-b4a2-0d7e6f3c9b81',
    name: 'Deepak V.',
    docs: [
      {
        slug: 'tsh-2026-07',
        kind: 'lab_report',
        title: 'Thyroid function test',
        recorded_on: '2026-07-20',
        source: 'clinic_db',
        description: 'TSH 2.1 mIU/L, within the normal range.',
        rows: [['TSH', '2.1 mIU/L', '0.4 – 4.0', '']]
      },
      {
        slug: 'tsh-2025-07',
        kind: 'lab_report',
        title: 'Thyroid function test',
        recorded_on: '2025-07-18',
        source: 'clinic_db',
        description: 'TSH 2.4 mIU/L, within the normal range.',
        rows: [['TSH', '2.4 mIU/L', '0.4 – 4.0', '']]
      },
      {
        slug: 'levothyroxine-rx',
        kind: 'prescription',
        title: 'Prescription: levothyroxine',
        recorded_on: '2024-07-15',
        source: 'clinic_db',
        description: 'Thyroid review: TSH normal, levothyroxine settled at 50 mcg once daily.',
        items: ['Levothyroxine 50 mcg', 'Once daily'],
        note: 'Hypothyroidism: dose unchanged'
      }
    ]
  },
  {
    id: 'a4c7e2f9-3b6d-4e18-8f5a-2b9c0d1e7a52',
    name: 'Fatima Z.',
    docs: [
      {
        slug: 'viral-fever-rx',
        kind: 'prescription',
        title: 'Prescription: viral fever',
        recorded_on: '2025-11-03',
        source: 'clinic_db',
        description: 'Viral fever for three days, treated with paracetamol and fluids.',
        items: ['Paracetamol, for fever', 'Oral fluids'],
        note: 'Viral fever, three days'
      }
    ]
  },
  {
    id: 'cb2759d8-3d91-4a4d-8bd2-026f68f76426',
    name: 'Ravi K.',
    docs: [
      {
        slug: 'penicillin-rash',
        kind: 'photo',
        title: 'Photo: urticarial rash',
        recorded_on: '2026-09-10',
        source: 'doctor_notes',
        description:
          'Hives within an hour of a penicillin injection at another clinic. Penicillin allergy recorded.',
        scene: 'rash'
      },
      {
        slug: 'amlodipine-rx',
        kind: 'prescription',
        title: 'Prescription: amlodipine',
        recorded_on: '2023-11-10',
        source: 'clinic_db',
        description: 'Hypertension diagnosed at about 150/96 mmHg; amlodipine 5 mg once daily started.',
        items: ['Amlodipine 5 mg', 'Once daily'],
        note: 'Hypertension, newly diagnosed'
      }
    ]
  },
  {
    id: '91786a1e-1ee8-4f60-8191-8a74c0e3edd1',
    name: 'Lakshmi S.',
    docs: [
      {
        slug: 'inr-2026-09',
        kind: 'lab_report',
        title: 'INR (warfarin monitoring)',
        recorded_on: '2026-09-01',
        source: 'clinic_db',
        description: 'INR 2.4, within the target range of 2 to 3.',
        rows: [['INR', '2.4', 'Target 2.0 – 3.0', '']]
      },
      {
        slug: 'inr-2026-06',
        kind: 'lab_report',
        title: 'INR (warfarin monitoring)',
        recorded_on: '2026-06-30',
        source: 'clinic_db',
        description: 'INR 1.9, just below the target range. Warfarin unchanged; recheck in eight weeks.',
        rows: [['INR', '1.9', 'Target 2.0 – 3.0', 'Low']]
      },
      {
        slug: 'af-ecg',
        kind: 'ecg',
        title: 'ECG: atrial fibrillation',
        recorded_on: '2026-06-02',
        source: 'clinic_db',
        description: 'Irregular rhythm recorded at the visit where atrial fibrillation was diagnosed.',
        rhythm: 'Atrial fibrillation'
      },
      {
        slug: 'warfarin-rx',
        kind: 'prescription',
        title: 'Prescription: warfarin',
        recorded_on: '2026-06-02',
        source: 'clinic_db',
        description: 'Warfarin 5 mg once daily started for atrial fibrillation. Target INR 2 to 3.',
        items: ['Warfarin 5 mg', 'Once daily'],
        note: 'Atrial fibrillation · target INR 2 – 3'
      }
    ]
  },
  {
    id: '9c7aa0d7-24a7-4a0d-93f0-3695c5d4df45',
    name: 'Arjun M.',
    docs: [
      {
        slug: 'hba1c-2026-01',
        kind: 'lab_report',
        title: 'HbA1c',
        recorded_on: '2026-01-15',
        source: 'clinic_db',
        description: 'HbA1c 8.1 %, above target and higher than the previous 7.4 %.',
        rows: [['HbA1c', '8.1 %', 'Below 5.7 (non-diabetic)', 'High']]
      },
      {
        slug: 'hba1c-2025-07',
        kind: 'lab_report',
        title: 'HbA1c',
        recorded_on: '2025-07-10',
        source: 'clinic_db',
        description: 'HbA1c 7.4 %.',
        rows: [['HbA1c', '7.4 %', 'Below 5.7 (non-diabetic)', 'High']]
      },
      {
        slug: 'metformin-rx',
        kind: 'prescription',
        title: 'Prescription: metformin',
        recorded_on: '2023-05-18',
        source: 'clinic_db',
        description: 'Type 2 diabetes diagnosed; metformin 500 mg twice daily started.',
        items: ['Metformin 500 mg', 'Twice daily'],
        note: 'Type 2 diabetes · diet and exercise advice'
      }
    ]
  },
  {
    id: 'b6f1c0e2-4d3a-4f7e-9a51-2c8d7e3f9a14',
    name: 'Priya N.',
    docs: [
      {
        slug: 'asthma-review-rx',
        kind: 'prescription',
        title: 'Prescription: asthma inhalers',
        recorded_on: '2025-08-20',
        source: 'clinic_db',
        description: 'Asthma well controlled at review; budesonide continued, salbutamol as needed.',
        items: ['Budesonide 200 mcg inhaler, twice daily', 'Salbutamol 100 mcg inhaler, as needed'],
        note: 'Asthma review: well controlled'
      },
      {
        slug: 'asthma-flare-rx',
        kind: 'prescription',
        title: 'Prescription: asthma flare',
        recorded_on: '2024-12-05',
        source: 'clinic_db',
        description: 'Asthma flare after a viral chest infection; short course of oral prednisolone.',
        items: ['Prednisolone, oral', 'Short course'],
        note: 'Asthma flare after a viral chest infection'
      }
    ]
  },
  {
    id: '4a2e9d71-8c5b-4e03-b7f6-91d2a3c4e5f8',
    name: 'Meena R.',
    docs: [
      {
        slug: 'glucose-2026-03',
        kind: 'lab_report',
        title: 'HbA1c and fasting glucose',
        recorded_on: '2026-03-24',
        source: 'clinic_db',
        description: 'HbA1c 6.2 %, borderline, with fasting glucose 108 mg/dL. Recheck in six months.',
        rows: [
          ['HbA1c', '6.2 %', 'Below 5.7', 'High'],
          ['Fasting glucose', '108 mg/dL', '70 – 99', 'High']
        ]
      },
      {
        slug: 'lipids-2024-10',
        kind: 'lab_report',
        title: 'Cholesterol',
        recorded_on: '2024-10-02',
        source: 'clinic_db',
        description: 'LDL cholesterol 162 mg/dL; atorvastatin started.',
        rows: [['LDL cholesterol', '162 mg/dL', 'Below 100', 'High']]
      },
      {
        slug: 'atorvastatin-rx',
        kind: 'prescription',
        title: 'Prescription: atorvastatin',
        recorded_on: '2024-10-02',
        source: 'clinic_db',
        description: 'Atorvastatin 10 mg once daily started for raised LDL cholesterol.',
        items: ['Atorvastatin 10 mg', 'Once daily'],
        note: 'Raised cholesterol'
      }
    ]
  },
  {
    id: 'd81f3b6a-2e7c-4a95-8c14-6b0e9f2d7a33',
    name: 'Farhan A.',
    docs: [
      {
        slug: 'renal-2026-06',
        kind: 'lab_report',
        title: 'Kidney function and HbA1c',
        recorded_on: '2026-06-18',
        source: 'clinic_db',
        description: 'eGFR 42, down from 51 in August 2025; HbA1c 7.0 %. CKD stage 3b recorded.',
        rows: [
          ['eGFR', '42 mL/min/1.73m²', 'Above 60', 'Low'],
          ['HbA1c', '7.0 %', 'Below 5.7', 'High']
        ]
      },
      {
        slug: 'renal-2025-08',
        kind: 'lab_report',
        title: 'Kidney function',
        recorded_on: '2025-08-12',
        source: 'clinic_db',
        description: 'eGFR 51 mL/min/1.73m².',
        rows: [['eGFR', '51 mL/min/1.73m²', 'Above 60', 'Low']]
      }
    ]
  },
  {
    id: '7c3a5e19-b2d4-4f86-a0e1-3f9b8c6d2e47',
    name: 'Kavya D.',
    docs: [
      {
        slug: 'anomaly-scan',
        kind: 'scan',
        title: 'Ultrasound: anomaly scan',
        recorded_on: '2026-08-07',
        source: 'clinic_db',
        description: 'Anomaly scan at 19 weeks, reported normal. BP 118/76 mmHg at the same check.',
        label: '19 weeks · anomaly scan · normal'
      },
      {
        slug: 'booking-bloods',
        kind: 'lab_report',
        title: 'Antenatal booking tests',
        recorded_on: '2026-06-12',
        source: 'clinic_db',
        description: 'Booking visit at 11 weeks: haemoglobin 10.8 g/dL, urine protein nil.',
        rows: [
          ['Haemoglobin', '10.8 g/dL', 'Above 11.0 (pregnancy)', 'Low'],
          ['Urine protein', 'Nil', 'Nil', '']
        ]
      },
      {
        slug: 'antenatal-rx',
        kind: 'prescription',
        title: 'Prescription: folic acid and iron',
        recorded_on: '2026-06-12',
        source: 'clinic_db',
        description: 'Folic acid and iron started at the booking visit.',
        items: ['Folic acid 400 mcg, once daily', 'Ferrous sulphate 200 mg, once daily'],
        note: 'Pregnancy, booking visit at 11 weeks'
      }
    ]
  },
  {
    id: '1e9d4c7b-6a3f-4b28-9d05-8e2c1b7a4f66',
    name: 'Arun P.',
    docs: [
      {
        slug: 'ankle-sprain-advice',
        kind: 'prescription',
        title: 'Advice: right ankle sprain',
        recorded_on: '2025-02-14',
        source: 'clinic_db',
        description: 'Right ankle sprain playing football: rest, ice, compression, paracetamol as needed.',
        items: ['Rest, ice, compression', 'Paracetamol, as needed'],
        note: 'Right ankle sprain'
      }
    ]
  },
  {
    id: 'e5b8c2d1-6f4a-4b97-8e3c-0a1d2f7b9c64',
    name: 'Gopal R.',
    docs: [
      {
        slug: 'heel-ulcer',
        kind: 'photo',
        title: 'Photo: left heel ulcer',
        recorded_on: '2026-09-15',
        source: 'clinic_db',
        description: 'Diabetic foot check: small ulcer on the left heel, cleaned and dressed. Review in one week.',
        scene: 'heel'
      }
    ]
  }
];

// ---------- Drawing helpers ----------

const esc = (s) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** '2026-07-20' -> '20 Jul 2026' */
function fmtDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Deterministic noise so re-running produces identical files */
function rng(seed) {
  let a = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const svg = (body, bg = '#ffffff') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${FONT}>
<rect width="${W}" height="${H}" fill="${bg}"/>
${body}
</svg>
`;

const demoStamp = (fill = '#9ca3af') =>
  `<text x="${W / 2}" y="${H - 20}" text-anchor="middle" font-size="11" letter-spacing="2" fill="${fill}">SYNTHETIC DEMO · NOT A REAL RECORD</text>`;

function paperHeader(title, patient, doc, accent) {
  return `<rect width="${W}" height="8" fill="${accent}"/>
<text x="32" y="52" font-size="13" font-weight="600" fill="#6b7280" letter-spacing="1.5">CITY CLINIC</text>
<text x="32" y="84" font-size="24" font-weight="700" fill="#111827">${esc(title)}</text>
<line x1="32" y1="104" x2="${W - 32}" y2="104" stroke="#e5e7eb"/>
<text x="32" y="130" font-size="13" fill="#6b7280">Patient</text>
<text x="32" y="150" font-size="16" font-weight="600" fill="#111827">${esc(patient.name)}</text>
<text x="${W - 32}" y="130" font-size="13" fill="#6b7280" text-anchor="end">Date</text>
<text x="${W - 32}" y="150" font-size="16" font-weight="600" fill="#111827" text-anchor="end">${fmtDate(doc.recorded_on)}</text>
<line x1="32" y1="170" x2="${W - 32}" y2="170" stroke="#e5e7eb"/>`;
}

// ---------- Templates ----------

function labReport(patient, doc) {
  const rows = doc.rows
    .map(([name, value, range, flag], i) => {
      const y = 236 + i * 64;
      const flagColor = flag === 'High' ? '#dc2626' : flag === 'Low' ? '#d97706' : '#059669';
      return `<rect x="32" y="${y - 26}" width="${W - 64}" height="52" rx="8" fill="${i % 2 ? '#ffffff' : '#f9fafb'}"/>
<text x="44" y="${y - 2}" font-size="15" font-weight="600" fill="#111827">${esc(name)}</text>
<text x="44" y="${y + 16}" font-size="11" fill="#6b7280">Ref: ${esc(range)}</text>
<text x="${W - 120}" y="${y + 6}" font-size="17" font-weight="700" fill="#111827" text-anchor="end">${esc(value)}</text>
<text x="${W - 44}" y="${y + 6}" font-size="12" font-weight="700" fill="${flagColor}" text-anchor="end">${flag || 'Normal'}</text>`;
    })
    .join('\n');
  return svg(`${paperHeader('Laboratory report', patient, doc, '#2563eb')}
<text x="32" y="196" font-size="12" font-weight="600" fill="#6b7280" letter-spacing="1">${esc(doc.title.toUpperCase())}</text>
${rows}
<text x="32" y="${H - 96}" font-size="12" fill="#6b7280">Filed to the clinic record</text>
<line x1="${W - 190}" y1="${H - 88}" x2="${W - 32}" y2="${H - 88}" stroke="#d1d5db"/>
<text x="${W - 32}" y="${H - 70}" font-size="11" fill="#9ca3af" text-anchor="end">Verified by lab</text>
${demoStamp()}`);
}

function prescription(patient, doc) {
  const items = doc.items
    .map((item, i) => {
      const y = 312 + i * 44;
      return `<circle cx="52" cy="${y - 5}" r="4" fill="#0f766e"/>
<text x="68" y="${y}" font-size="16" fill="#111827">${esc(item)}</text>`;
    })
    .join('\n');
  return svg(`${paperHeader('Prescription', patient, doc, '#0f766e')}
<text x="32" y="198" font-size="12" fill="#6b7280">Diagnosis / reason</text>
<text x="32" y="220" font-size="14" font-weight="600" fill="#111827">${esc(doc.note)}</text>
<text x="32" y="286" font-size="44" font-weight="700" font-style="italic" fill="#0f766e">℞</text>
${items}
<line x1="${W - 190}" y1="${H - 96}" x2="${W - 32}" y2="${H - 96}" stroke="#d1d5db"/>
<path d="M ${W - 180} ${H - 104} q 18 -26 30 -4 t 30 -6 t 34 2" fill="none" stroke="#1f2937" stroke-width="1.6"/>
<text x="${W - 32}" y="${H - 78}" font-size="11" fill="#9ca3af" text-anchor="end">Treating doctor</text>
${demoStamp()}`, '#fffdf8');
}

function ecg(patient, doc) {
  const rand = rng(doc.slug);
  let grid = '';
  for (let x = 0; x <= W; x += 12) {
    grid += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#fbcfe8" stroke-width="${x % 60 ? 0.5 : 1.2}"/>`;
  }
  for (let y = 0; y <= H; y += 12) {
    grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#fbcfe8" stroke-width="${y % 60 ? 0.5 : 1.2}"/>`;
  }
  // Irregularly irregular R-R intervals and a fibrillating baseline with no P waves
  const lead = (baseY) => {
    let d = `M 0 ${baseY}`;
    let x = 0;
    while (x < W) {
      const gap = 44 + rand() * 60;
      for (let t = 0; t < gap - 26; t += 4) d += ` L ${x + t} ${baseY + (rand() - 0.5) * 6}`;
      x += gap - 26;
      d += ` L ${x + 4} ${baseY + 6} L ${x + 9} ${baseY - 62} L ${x + 14} ${baseY + 16} L ${x + 18} ${baseY}`;
      d += ` Q ${x + 24} ${baseY - 12} ${x + 26} ${baseY}`;
      x += 26;
    }
    return `<path d="${d}" fill="none" stroke="#111827" stroke-width="1.6" stroke-linejoin="round"/>`;
  };
  return svg(`${grid}
<rect x="0" y="0" width="${W}" height="118" fill="#ffffff" opacity="0.92"/>
<text x="24" y="40" font-size="13" font-weight="600" fill="#6b7280" letter-spacing="1.5">12-LEAD ECG · RHYTHM STRIP</text>
<text x="24" y="70" font-size="18" font-weight="700" fill="#111827">${esc(patient.name)}</text>
<text x="24" y="96" font-size="13" fill="#374151">${fmtDate(doc.recorded_on)} · 25 mm/s · 10 mm/mV</text>
<text x="20" y="200" font-size="12" font-weight="700" fill="#9d174d">II</text>
${lead(250)}
<text x="20" y="340" font-size="12" font-weight="700" fill="#9d174d">V1</text>
${lead(390)}
<text x="20" y="480" font-size="12" font-weight="700" fill="#9d174d">V5</text>
${lead(530)}
<rect x="0" y="${H - 44}" width="${W}" height="44" fill="#ffffff" opacity="0.92"/>
<text x="24" y="${H - 18}" font-size="13" font-weight="600" fill="#9d174d">${esc(doc.rhythm)}</text>
<text x="${W - 24}" y="${H - 18}" text-anchor="end" font-size="10" letter-spacing="1.5" fill="#9ca3af">SYNTHETIC DEMO</text>`, '#fff5f8');
}

function scan(patient, doc) {
  const rand = rng(doc.slug);
  const cx = W / 2;
  const top = 110;
  let speckle = '';
  for (let i = 0; i < 900; i++) {
    const a = (-38 + rand() * 76) * (Math.PI / 180);
    const r = 40 + rand() * 400;
    const x = cx + Math.sin(a) * r;
    const y = top + Math.cos(a) * r;
    speckle += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.6 + rand() * 1.6).toFixed(1)}" fill="#ffffff" opacity="${(0.08 + rand() * 0.35).toFixed(2)}"/>`;
  }
  return svg(`<defs>
  <clipPath id="fan"><path d="M ${cx} ${top} L ${cx - 270} ${top + 350} A 440 440 0 0 0 ${cx + 270} ${top + 350} Z"/></clipPath>
  <radialGradient id="glow" cx="50%" cy="10%" r="90%"><stop offset="0" stop-color="#3f3f46"/><stop offset="1" stop-color="#18181b"/></radialGradient>
</defs>
<g clip-path="url(#fan)">
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  ${speckle}
  <ellipse cx="${cx}" cy="340" rx="118" ry="96" fill="#0a0a0a" opacity="0.85"/>
  <path d="M ${cx - 70} 356 q 20 -70 78 -62 q 44 8 40 48 q -6 34 -44 40 q -20 4 -30 22 q -10 20 -34 14 q -22 -8 -10 -62 z" fill="#d4d4d8" opacity="0.75"/>
  <circle cx="${cx + 30}" cy="318" r="24" fill="#e4e4e7" opacity="0.8"/>
  <ellipse cx="${cx}" cy="340" rx="118" ry="96" fill="none" stroke="#a1a1aa" stroke-width="2" opacity="0.6"/>
</g>
<text x="24" y="36" font-size="12" fill="#a1a1aa" letter-spacing="1.5">OBSTETRIC ULTRASOUND</text>
<text x="24" y="60" font-size="16" font-weight="600" fill="#f4f4f5">${esc(patient.name)}</text>
<text x="${W - 24}" y="36" font-size="12" fill="#a1a1aa" text-anchor="end">${fmtDate(doc.recorded_on)}</text>
<text x="${W - 24}" y="60" font-size="12" fill="#a1a1aa" text-anchor="end">C5-2 · 3.5 MHz</text>
<text x="24" y="${H - 52}" font-size="14" font-weight="600" fill="#f4f4f5">${esc(doc.label)}</text>
${demoStamp('#71717a')}`, '#09090b');
}

function photo(patient, doc) {
  const rand = rng(doc.slug);
  let scene = '';
  if (doc.scene === 'rash') {
    // Forearm with raised hives
    scene = `<path d="M -20 420 C 90 360 230 330 520 250 L 520 400 C 300 450 140 500 -20 560 Z" fill="#c68b64"/>
<path d="M -20 420 C 90 360 230 330 520 250" fill="none" stroke="#a86f4b" stroke-width="3" opacity="0.5"/>`;
    for (let i = 0; i < 26; i++) {
      const x = 40 + rand() * 420;
      const yTop = 420 - ((x + 20) / 540) * 170;
      const y = yTop + 30 + rand() * 90;
      const rx = 10 + rand() * 18;
      scene += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${(rx * (0.6 + rand() * 0.4)).toFixed(0)}" fill="#e7837a" opacity="0.55"/>
<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(rx * 0.55).toFixed(0)}" ry="${(rx * 0.35).toFixed(0)}" fill="#f6c2b5" opacity="0.7"/>`;
    }
  } else {
    // Sole of the left foot with a dressed heel
    scene = `<path d="M 240 150 C 330 150 350 230 340 320 C 332 390 350 450 330 510 C 310 570 180 575 160 510 C 140 450 160 400 150 330 C 140 240 160 150 240 150 Z" fill="#c68b64"/>
<g fill="#b87a55">
  <ellipse cx="200" cy="140" rx="22" ry="26"/><ellipse cx="240" cy="128" rx="16" ry="20"/>
  <ellipse cx="272" cy="134" rx="14" ry="17"/><ellipse cx="298" cy="146" rx="12" ry="15"/><ellipse cx="320" cy="162" rx="10" ry="13"/>
</g>
<rect x="196" y="452" width="100" height="72" rx="14" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/>
<rect x="222" y="472" width="48" height="32" rx="6" fill="#fde2e2" opacity="0.9"/>
<circle cx="246" cy="488" r="8" fill="none" stroke="#1d4ed8" stroke-width="2" stroke-dasharray="3 3"/>
<line x1="296" y1="488" x2="380" y2="440" stroke="#1d4ed8" stroke-width="2"/>
<text x="384" y="436" font-size="13" font-weight="600" fill="#1d4ed8">Ulcer site</text>`;
  }
  return svg(`<rect x="0" y="0" width="${W}" height="${H}" fill="#e7e5e4"/>
${scene}
<rect x="24" y="24" width="${W - 48}" height="64" rx="12" fill="#ffffff" opacity="0.92"/>
<text x="40" y="50" font-size="12" fill="#6b7280" letter-spacing="1.5">CLINICAL PHOTO · ILLUSTRATION</text>
<text x="40" y="74" font-size="16" font-weight="600" fill="#111827">${esc(patient.name)} · ${fmtDate(doc.recorded_on)}</text>
<rect x="30" y="${H - 108}" width="96" height="10" fill="#111827"/>
<text x="30" y="${H - 80}" font-size="11" fill="#44403c">Scale 5 cm</text>
${demoStamp('#78716c')}`);
}

const TEMPLATES = { lab_report: labReport, prescription, ecg, scan, photo };

// ---------- Write ----------

const outDir = path.join(ROOT, 'public', 'documents');
rmSync(outDir, { recursive: true, force: true });

const metadata = {};
for (const patient of PATIENTS) {
  mkdirSync(path.join(outDir, patient.id), { recursive: true });
  metadata[patient.id] = patient.docs.map((doc) => {
    const file = `${doc.slug}.svg`;
    writeFileSync(path.join(outDir, patient.id, file), TEMPLATES[doc.kind](patient, doc));
    return {
      id: `${patient.id}-${doc.slug}`,
      title: doc.title,
      kind: doc.kind,
      src: `/documents/${patient.id}/${file}`,
      recorded_on: doc.recorded_on,
      source: doc.source,
      description: doc.description
    };
  });
}

const ts = `// ============================================================
// GENERATED by website/scripts/generate_mock_documents.mjs. Do not edit by hand.
// ============================================================
// The demo patients' files (scans, reports, photos). The images are synthetic SVGs in
// public/documents/, and each one only restates what the patient's record already says.
// ============================================================

import type { PatientDocument } from '@/features/patients/api/types';

export const MOCK_DOCUMENTS: Record<string, PatientDocument[]> = ${JSON.stringify(metadata, null, 2)};
`;
writeFileSync(path.join(ROOT, 'src', 'constants', 'mock-documents.ts'), ts);

const count = Object.values(metadata).reduce((n, docs) => n + docs.length, 0);
console.log(`Wrote ${count} documents for ${PATIENTS.length} patients`);
