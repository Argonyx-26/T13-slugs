from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine

from pathlib import Path
import sys

analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

PII_ENTITIES = [
    "PERSON",
    "PHONE_NUMBER",
    "EMAIL_ADDRESS",
    "LOCATION",
    "US_DRIVER_LICENSE",
    "US_PASSPORT",
    "IP_ADDRESS",
]


def scrub_text(text):
    results = analyzer.analyze(
        text=text,
        language="en",
        entities=PII_ENTITIES
    )

    anonymized = anonymizer.anonymize(
        text=text,
        analyzer_results=results
    )

    return anonymized.text


def process_file(input_file):
    input_path = Path(input_file)

    if not input_path.exists():
        print("ERROR: File not found:")
        print(input_path)
        return

    output_path = input_path.with_name(
        input_path.stem + "_pii_scrubbed.txt"
    )

    lines = input_path.read_text(
        encoding="utf-8"
    ).splitlines()

    output = []

    for line in lines:
        if not line.strip():
            continue

        if "]: " in line:
            prefix, text = line.split("]: ", 1)

            cleaned_text = scrub_text(text)

            output.append(
                prefix + "]: " + cleaned_text
            )
        else:
            output.append(
                scrub_text(line)
            )

    output_path.write_text(
        "\n".join(output),
        encoding="utf-8"
    )

    print()
    print("==========================================")
    print("PII SCRUBBING COMPLETE")
    print("==========================================")
    print()
    print("Input:")
    print(input_path)
    print()
    print("Output:")
    print(output_path)
    print()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage:")
        print("python pii_scrubber.py <roles.txt>")
        sys.exit(1)

    process_file(sys.argv[1])