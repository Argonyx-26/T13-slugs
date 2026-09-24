from pathlib import Path
import sys
import re


# ============================================================
# CONTEXT-AWARE DOCTOR / PATIENT ROLE IDENTIFIER
# ============================================================

DOCTOR_PATTERNS = [
    # Greetings / consultation opening
    r"\bgood morning\b",
    r"\bgood afternoon\b",
    r"\bgood evening\b",
    r"\bplease have a seat\b",
    r"\bwhat brings you in\b",

    # Clinical questions
    r"\bwhat symptoms\b",
    r"\bwhat brings you\b",
    r"\bwhen did\b",
    r"\bhow long\b",
    r"\bwhere do you\b",
    r"\bare you currently\b",
    r"\bdo you have\b",
    r"\bhave you\b",
    r"\bhave you experienced\b",
    r"\bare you experiencing\b",
    r"\bwhat is your\b",
    r"\bcan you tell me\b",

    # Medical questioning
    r"\bmedication\b",
    r"\ballergies\b",
    r"\bmedical conditions\b",
    r"\bmedical history\b",
    r"\bdifficulty breathing\b",
    r"\bchest pain\b",
    r"\bnausea\b",
    r"\bvomiting\b",
    r"\bdiarrhea\b",
    r"\bblood pressure\b",
    r"\btemperature\b",
    r"\bvital signs\b",

    # Doctor actions
    r"\bi'll examine\b",
    r"\bi will examine\b",
    r"\bi'll check\b",
    r"\bi will check\b",
    r"\bi'll explain\b",
    r"\bi will explain\b",
    r"\blet me check\b",
    r"\blet me examine\b",
]


PATIENT_PATTERNS = [
    # Personal symptoms
    r"\bi have\b",
    r"\bi've had\b",
    r"\bi've been\b",
    r"\bi am\b",
    r"\bi'm\b",
    r"\bi feel\b",
    r"\bi've been feeling\b",
    r"\bi've experienced\b",

    # Patient history / conditions
    r"\bmy symptoms\b",
    r"\bmy temperature\b",
    r"\bmy phone\b",
    r"\bmy email\b",
    r"\bmy name\b",
    r"\bmy medical\b",
    r"\bmy history\b",

    # Patient responses
    r"\byes\b",
    r"\bno\b",
    r"\bnone\b",
    r"\bnot taking\b",
    r"\bi don't\b",
    r"\bi do not\b",
    r"\bi haven't\b",
    r"\bi have not\b",
    r"\bi'm not\b",
    r"\bi am not\b",

    # Medical information usually supplied by patient
    r"\bi am allergic\b",
    r"\bi'm allergic\b",
    r"\bi have type\b",
    r"\bi take\b",
    r"\bi'm taking\b",
    r"\bi am taking\b",

    # Patient identifying information
    r"\bmy name is\b",
    r"\bmy phone number is\b",
    r"\bmy email is\b",
    r"\bi live at\b",
    r"\bi live in\b",
]


def clean_text(text):
    """
    Remove leading/trailing whitespace and normalize spaces.
    """
    return re.sub(r"\s+", " ", text.strip())


def is_question(text):
    """
    Detect whether an utterance is likely a question.
    """
    text_lower = text.lower().strip()

    if "?" in text:
        return True

    question_starts = [
        "what ",
        "when ",
        "where ",
        "why ",
        "how ",
        "do you ",
        "does ",
        "did you ",
        "are you ",
        "is ",
        "have you ",
        "can you ",
        "could you ",
        "would you ",
    ]

    return any(text_lower.startswith(x) for x in question_starts)


def score_patterns(text, patterns):
    """
    Count matching patterns.
    """
    text_lower = text.lower()
    score = 0

    for pattern in patterns:
        if re.search(pattern, text_lower):
            score += 1

    return score


def looks_like_patient_answer(text):
    """
    Detect answers that normally follow a doctor's question.
    """

    text_lower = text.lower().strip()

    patient_answer_patterns = [
        r"^yes\b",
        r"^no\b",
        r"^none\b",
        r"^not really\b",
        r"^i\b",
        r"^my\b",
        r"^it\b",
        r"^they\b",
        r"^about\b",
        r"^around\b",
        r"^since\b",
        r"^for\b",
    ]

    for pattern in patient_answer_patterns:
        if re.search(pattern, text_lower):
            return True

    return False


def looks_like_doctor_instruction(text):
    """
    Detect doctor instructions / planned clinical actions.
    """

    text_lower = text.lower()

    patterns = [
        r"\bplease\b",
        r"\bi'll\b",
        r"\bi will\b",
        r"\blet me\b",
        r"\byou should\b",
        r"\byou need to\b",
        r"\bi recommend\b",
        r"\bi'd like you to\b",
    ]

    return any(re.search(p, text_lower) for p in patterns)


def classify_first_utterance(text):
    """
    Establish an initial role estimate.
    """

    doctor_score = score_patterns(text, DOCTOR_PATTERNS)
    patient_score = score_patterns(text, PATIENT_PATTERNS)

    if doctor_score > patient_score:
        return "DOCTOR"

    if patient_score > doctor_score:
        return "PATIENT"

    # Consultation-opening phrases are usually spoken by doctor.
    if re.search(
        r"\b(good morning|good afternoon|good evening)\b",
        text.lower()
    ):
        return "DOCTOR"

    return "UNKNOWN"


def identify_roles(lines):
    """
    Context-aware role assignment.

    Important:
    SPEAKER_00 / SPEAKER_01 are preserved exactly as provided
    by diarization.

    Role assignment is independent of speaker number.
    """

    results = []

    previous_role = None
    previous_text = ""
    previous_was_question = False

    for index, line in enumerate(lines):

        line = line.strip()

        if not line:
            continue

        # --------------------------------------------------------
        # Parse speaker ID
        # --------------------------------------------------------

        speaker_match = re.match(
            r"\[(SPEAKER_\d+)\]:\s*(.*)",
            line
        )

        if not speaker_match:
            continue

        speaker_id = speaker_match.group(1)
        text = clean_text(speaker_match.group(2))

        # --------------------------------------------------------
        # Score current utterance
        # --------------------------------------------------------

        doctor_score = score_patterns(
            text,
            DOCTOR_PATTERNS
        )

        patient_score = score_patterns(
            text,
            PATIENT_PATTERNS
        )

        current_is_question = is_question(text)

        # --------------------------------------------------------
        # Strong doctor evidence
        # --------------------------------------------------------

        if current_is_question and doctor_score >= 1:
            role = "DOCTOR"

        elif looks_like_doctor_instruction(text):
            role = "DOCTOR"

        # --------------------------------------------------------
        # Strong patient evidence
        # --------------------------------------------------------

        elif patient_score >= 2:
            role = "PATIENT"

        # --------------------------------------------------------
        # QUESTION → ANSWER CONTEXT
        # --------------------------------------------------------

        elif previous_was_question:
            """
            A direct response to a doctor's question is
            normally the patient's answer.

            Example:

            Doctor:
                Where do you currently live?

            Patient:
                1124 Green Park Road, Bangalore.
            """

            if previous_role == "DOCTOR":
                role = "PATIENT"

            else:
                role = "PATIENT"

        # --------------------------------------------------------
        # Patient-style answer
        # --------------------------------------------------------

        elif looks_like_patient_answer(text):

            if previous_role == "DOCTOR":
                role = "PATIENT"

            elif patient_score > doctor_score:
                role = "PATIENT"

            else:
                role = "UNKNOWN"

        # --------------------------------------------------------
        # Speaker continuity
        # --------------------------------------------------------

        else:

            # If the same speaker continues immediately and
            # there is no contradictory evidence, preserve role.

            previous_speaker = None

            if results:
                previous_speaker = results[-1]["speaker"]

            if speaker_id == previous_speaker and previous_role:
                role = previous_role

            else:

                if doctor_score > patient_score:
                    role = "DOCTOR"

                elif patient_score > doctor_score:
                    role = "PATIENT"

                else:
                    role = "UNKNOWN"

        # --------------------------------------------------------
        # Context correction
        # --------------------------------------------------------

        # A sentence giving personal medical information should
        # almost always be patient speech.

        personal_medical_patterns = [
            r"\bi am allergic\b",
            r"\bi'm allergic\b",
            r"\bi have type\b",
            r"\bi have diabetes\b",
            r"\bi have\b",
            r"\bi'm taking\b",
            r"\bi am taking\b",
            r"\bmy temperature\b",
            r"\bmy name is\b",
            r"\bmy phone number is\b",
            r"\bmy email is\b",
            r"\bi live at\b",
            r"\bi live in\b",
        ]

        if any(
            re.search(pattern, text.lower())
            for pattern in personal_medical_patterns
        ):
            role = "PATIENT"

        # --------------------------------------------------------
        # Doctor-specific closing / action statements
        # --------------------------------------------------------

        if re.search(
            r"\b(i'll|i will)\s+(check|examine|explain|review)",
            text.lower()
        ):
            role = "DOCTOR"

        # --------------------------------------------------------
        # Save result
        # --------------------------------------------------------

        results.append({
            "speaker": speaker_id,
            "role": role,
            "text": text
        })

        previous_role = role
        previous_text = text
        previous_was_question = current_is_question

    return results


def process_file(input_file):

    input_path = Path(input_file)

    if not input_path.exists():
        print("ERROR: File not found:")
        print(input_path)
        return

    output_path = input_path.with_name(
        input_path.stem + "_roles.txt"
    )

    lines = input_path.read_text(
        encoding="utf-8"
    ).splitlines()

    results = identify_roles(lines)

    output_lines = []

    for item in results:

        output_lines.append(
            f"[{item['role']}] "
            f"[{item['speaker']}]: "
            f"{item['text']}"
        )

    output_path.write_text(
        "\n".join(output_lines),
        encoding="utf-8"
    )

    print()
    print("==========================================")
    print("ROLE IDENTIFICATION COMPLETE")
    print("==========================================")
    print()
    print("Input:")
    print(input_path)
    print()
    print("Output:")
    print(output_path)
    print()
    print("Total utterances:", len(results))
    print()


if __name__ == "__main__":

    if len(sys.argv) != 2:
        print("Usage:")
        print("python role_identifier.py <transcript.txt>")
        sys.exit(1)

    process_file(sys.argv[1])