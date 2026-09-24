from pathlib import Path
import sys
import re

from audio_engine import transcribe_audio


def classify_role(text, previous_role, waiting_for_answer):

    t = text.lower().strip()

    # Greetings
    if t in [
        "good morning",
        "good afternoon",
        "good evening",
        "hello",
        "hi",
    ]:
        return "DOCTOR", True

    # Doctor indicators
    doctor_phrases = [
        "what brings you",
        "what symptoms",
        "can you tell me",
        "where do you",
        "what is your phone",
        "what email",
        "when did",
        "how long",
        "are you currently",
        "are you taking",
        "do you have",
        "have you experienced",
        "have you had",
        "any known allergies",
        "any allergies",
        "existing medical conditions",
        "difficulty breathing",
        "chest pain",
        "symptoms before",
        "please have a seat",
        "i'll check",
        "i will check",
        "let me check",
        "i'll examine",
        "i will examine",
        "your temperature",
        "your blood pressure",
        "your vital signs",
    ]

    # Patient indicators
    patient_phrases = [
        "my name is",
        "i've been feeling",
        "i have been feeling",
        "i've had",
        "i have had",
        "my temperature",
        "my phone number",
        "my email",
        "my address",
        "i am taking",
        "i'm taking",
        "i take",
        "i am allergic",
        "i'm allergic",
        "i have type",
        "i don't have",
        "i do not have",
        "it started",
        "it began",
        "i feel",
        "i'm feeling",
        "i have been",
        "good morning, doctor",
    ]

    # Questions
    if "?" in text:
        return "DOCTOR", True

    for phrase in doctor_phrases:
        if phrase in t:
            return "DOCTOR", True

    # Patient information
    for phrase in patient_phrases:
        if phrase in t:
            return "PATIENT", False

    # Medical answers
    medical_patterns = [
        r"\bfever\b",
        r"\bcough\b",
        r"\bheadache\b",
        r"\bpain\b",
        r"\btemperature\b",
        r"\bparacetamol\b",
        r"\bpenicillin\b",
        r"\bdiabetes\b",
        r"\bmedicine\b",
        r"\bmedication\b",
        r"\ballergic\b",
        r"\bbreathing\b",
        r"\bchest pain\b",
        r"\byesterday\b",
        r"\btoday\b",
        r"\bfour days\b",
        r"\b4 days\b",
        r"\bthree days\b",
        r"\b3 days\b",
        r"\btwo days\b",
        r"\b2 days\b",
    ]

    for pattern in medical_patterns:
        if re.search(pattern, t):
            if waiting_for_answer:
                return "PATIENT", False

    # Doctor asked something → next statement is patient
    if waiting_for_answer:
        return "PATIENT", False

    # Continue previous role
    if previous_role:
        return previous_role, previous_role == "DOCTOR"

    return "UNKNOWN", False


def identify_roles(diarized_text):

    lines = diarized_text.splitlines()

    output = []

    previous_role = None
    waiting_for_answer = False

    for line in lines:

        if not line.strip():
            continue

        if "]:" in line:
            _, text = line.split("]:", 1)
            text = text.strip()
        else:
            text = line.strip()

        role, waiting_for_answer = classify_role(
            text,
            previous_role,
            waiting_for_answer
        )

        output.append(
            f"[{role}]: {text}"
        )

        previous_role = role

    return "\n".join(output)


def process_consultation(file_path):

    print()
    print("=" * 60)
    print("LUMEN AUDIO PIPELINE")
    print("=" * 60)
    print()

    print("[1/2] WhisperX + speaker diarization...")
    print()

    diarized_text = transcribe_audio(file_path)

    print("[2/2] Context-aware Doctor/Patient detection...")
    print()

    role_text = identify_roles(diarized_text)

    # SAVE ROLE TRANSCRIPT
    input_path = Path(file_path)

    role_output = input_path.with_name(
        input_path.stem + "_roles.txt"
    )

    role_output.write_text(
        role_text,
        encoding="utf-8"
    )

    print()
    print("Role transcript saved to:")
    print(role_output)
    print()

    return role_text


if __name__ == "__main__":

    if len(sys.argv) != 2:
        print(
            'Usage: python lumen_audio_pipeline.py "audio_file"'
        )
        sys.exit(1)

    audio_file = sys.argv[1]

    if not Path(audio_file).exists():
        print("ERROR: File not found:")
        print(audio_file)
        sys.exit(1)

    try:

        result = process_consultation(audio_file)

        print("=" * 60)
        print("LUMEN CONTEXT-AWARE TRANSCRIPT")
        print("=" * 60)
        print()

        print(result)

        print()
        print("=" * 60)

    except Exception as e:

        print()
        print("ERROR:")
        print(e)
        sys.exit(1)