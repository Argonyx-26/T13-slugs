"""Six synthetic patients, each with one planted issue, buried among routine records so retrieval has to choose.

Dates are 'days before seeding'. The consult scripts for the demo audio must match the `consult` blocks.
`clinical` is what the Brain's first pass should produce: a clinical rewording of the consult. Tested
(meaning-only ranking): it lifts P-004's HbA1c note from #4 to #2 and P-001's asthma note from #5 to #2 of 17.
`vitals` are taken at the desk on the consult day; `vitals_history` are earlier readings (days before seeding),
which the risk engine uses for trends. P-006 is the triage case: the sickest patient, who must jump the queue.
"""
import random

# Routine records shared across patients (none mention the planted issues)
FILLER = [
    ("visit", "Common cold with runny nose and sore throat. Advised rest and fluids."),
    ("visit", "Influenza vaccination administered."),
    ("visit", "Right ankle sprain after a fall. Rest, ice, compression; paracetamol as needed."),
    ("visit", "Routine blood pressure check: 124/80 mmHg."),
    ("visit", "Dental pain; referred to dentist."),
    ("lab", "Lipid profile within normal limits."),
    ("visit", "Viral fever for three days. Paracetamol and fluids."),
    ("visit", "Allergic conjunctivitis. Lubricating eye drops."),
    ("visit", "Mild gastritis. Pantoprazole 40 mg for 2 weeks."),
    ("lab", "Vitamin D 18 ng/mL (low). Cholecalciferol 60,000 IU weekly for 8 weeks."),
    ("lab", "Complete blood count within normal limits."),
    ("visit", "Tetanus booster after a minor cut on the hand."),
    ("visit", "Seasonal allergic rhinitis. Cetirizine 10 mg at night for 1 week."),
    ("visit", "Annual health check, no concerns."),
    ("visit", "Acute gastroenteritis. Oral rehydration salts."),
    ("visit", "Mild neck strain from poor posture. Stretching exercises advised."),
    ("lab", "Thyroid function tests within normal limits."),
    ("visit", "Minor skin abrasion cleaned and dressed."),
    ("visit", "Difficulty sleeping due to work stress. Sleep hygiene advice."),
    ("visit", "Heartburn after spicy meals. Antacid as needed."),
]
N_FILLER = 15

PATIENTS = [
    {
        "code": "P-001", "age": 34, "sex": "F",
        "story": "Asthmatic patient; doctor prescribes propranolol for migraine.",
        "records": [
            (3650, "diagnosis", "Bronchial asthma since childhood."),
            (400, "prescription", "Budesonide 200 mcg inhaler twice daily (long-term); salbutamol 100 mcg inhaler as needed."),
            (700, "visit", "Acute asthma exacerbation after a viral infection, nebulised salbutamol. "
                           "Avoid non-selective beta-blockers such as propranolol."),
            (200, "visit", "Episodic headaches, likely tension-type. Paracetamol as needed."),
            (1500, "allergy", "No known drug allergies."),
        ],
        "doctor_notes": [],
        "consult": {"symptoms": ["recurrent migraine headaches", "nausea with headaches"],
                    "medications": ["propranolol 40 mg"],
                    "clinical": ["migraine prophylaxis with a beta-blocker"],
                    "vitals": {"resp_rate": 16, "spo2": 98, "systolic_bp": 118, "diastolic_bp": 76, "heart_rate": 78, "temperature_c": 36.8, "consciousness": "alert"}},
    },
    {
        "code": "P-002", "age": 45, "sex": "M",
        "story": "Clinic record says no allergies (old); doctor's own recent note records an amoxicillin rash; doctor prescribes Augmentin.",
        "records": [
            (1800, "allergy", "No known drug allergies."),
            (900, "diagnosis", "Chronic rhinosinusitis."),
            (300, "visit", "Sinusitis flare, treated with steam inhalation and saline nasal spray."),
        ],
        "doctor_notes": [
            (14, {"allergies": ["Rash and itching after an amoxicillin course prescribed at another clinic"],
                  "history": "Patient reports a skin reaction to amoxicillin three weeks ago. Advised to avoid penicillins."}),
        ],
        "consult": {"symptoms": ["facial pain and nasal congestion for ten days", "thick nasal discharge"],
                    "medications": ["Augmentin 625"],
                    "clinical": ["acute bacterial sinusitis treated with a penicillin antibiotic"],
                    "vitals": {"resp_rate": 16, "spo2": 98, "systolic_bp": 126, "diastolic_bp": 82, "heart_rate": 84, "temperature_c": 37.4, "consciousness": "alert"}},
    },
    {
        "code": "P-003", "age": 67, "sex": "M",
        "story": "On warfarin for atrial fibrillation; doctor suggests ibuprofen for back pain.",
        "records": [
            (2500, "diagnosis", "Atrial fibrillation."),
            (60, "prescription", "Warfarin 5 mg once daily (long-term), target INR 2-3."),
            (30, "lab", "INR 2.6 (in target range)."),
            (500, "visit", "Knee pain. Avoid NSAIDs like ibuprofen while on warfarin; paracetamol for pain."),
            (1200, "allergy", "No known drug allergies."),
        ],
        "doctor_notes": [],
        "consult": {"symptoms": ["lower back pain for one week"], "medications": ["ibuprofen 400 mg"],
                    "clinical": ["NSAID analgesic for back pain"],
                    "vitals": {"resp_rate": 16, "spo2": 98, "systolic_bp": 134, "diastolic_bp": 84, "heart_rate": 88, "temperature_c": 36.7, "consciousness": "alert"}},
    },
    {
        "code": "P-004", "age": 52, "sex": "F",
        "story": "Borderline HbA1c 6 months ago, only in a lab note (never on the condition list); now always thirsty. "
                 "Blood pressure has crept up at every visit and she has lost weight: early risk, not an emergency.",
        "records": [
            (182, "lab", "HbA1c 6.2% (borderline, prediabetic range). Fasting glucose 118 mg/dL. "
                         "Lifestyle advice given; recheck HbA1c in 6 months."),
            (760, "visit", "Urinary tract infection with burning on urination. Nitrofurantoin 100 mg for 5 days."),
            (1500, "allergy", "No known drug allergies."),
        ],
        "doctor_notes": [],
        "consult": {"symptoms": ["excessive thirst", "frequent urination at night", "tiredness"],
                    "medications": [],
                    "clinical": ["polydipsia and polyuria, possible hyperglycaemia or diabetes; check blood glucose and HbA1c"],
                    "vitals": {"resp_rate": 16, "spo2": 98, "systolic_bp": 148, "diastolic_bp": 94, "heart_rate": 84,
                               "temperature_c": 36.8, "consciousness": "alert", "blood_glucose": 232, "weight_kg": 69.5}},
        "vitals_history": [(400, {"systolic_bp": 128, "diastolic_bp": 82, "heart_rate": 76, "weight_kg": 74.0}),
                           (182, {"systolic_bp": 136, "diastolic_bp": 86, "heart_rate": 80, "weight_kg": 74.0})],
    },
    {
        "code": "P-005", "age": 28, "sex": "M",
        "story": "Healthy; simple cold. Control case: nothing should be flagged.",
        "records": [
            (1000, "allergy", "No known drug allergies."),
        ],
        "doctor_notes": [],
        "consult": {"symptoms": ["runny nose", "sore throat", "mild fever"], "medications": ["paracetamol 650 mg"],
                    "clinical": ["upper respiratory tract infection"],
                    "vitals": {"resp_rate": 16, "spo2": 98, "systolic_bp": 118, "diastolic_bp": 74, "heart_rate": 88, "temperature_c": 37.9, "consciousness": "alert"}},
    },
    {
        "code": "P-006", "age": 61, "sex": "M",
        "story": "Diabetic with an infected heel ulcer; now fever, chills and new confusion. The triage case: "
                 "vital signs at check-in must put him at the top of the queue as possible sepsis.",
        "records": [
            (3000, "diagnosis", "Type 2 diabetes mellitus."),
            (90, "prescription", "Metformin 500 mg twice daily (long-term)."),
            (10, "visit", "Diabetic foot check: small ulcer on the left heel, cleaned and dressed. Review in one week."),
            (1500, "allergy", "No known drug allergies."),
        ],
        "doctor_notes": [],
        "consult": {"symptoms": ["fever with chills since yesterday", "confusion since this morning",
                                 "redness and pus from the heel wound"],
                    "medications": [],
                    "clinical": ["infected diabetic foot ulcer with systemic infection"],
                    "vitals": {"resp_rate": 24, "spo2": 94, "systolic_bp": 94, "diastolic_bp": 58, "heart_rate": 118,
                               "temperature_c": 38.9, "consciousness": "new_confusion", "blood_glucose": 240}},
    },
]


def records_for(patient: dict) -> list[tuple[int, str, str]]:
    """Planted records + a fixed (per patient) random pick of routine ones spread over five years."""
    rng = random.Random(patient["code"])
    filler = [(rng.randint(20, 1825), t, c) for t, c in rng.sample(FILLER, N_FILLER)]
    return patient["records"] + filler
