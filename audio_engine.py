import subprocess
import sys
import tempfile
from pathlib import Path

from huggingface_hub import get_token


def transcribe_audio(file_path: str) -> str:
    """
    Transcribe and diarize an audio/video file using WhisperX.

    Args:
        file_path: Path to the input audio/video file.

    Returns:
        Clean diarized transcript as a string.
    """

    input_path = Path(file_path)

    if not input_path.exists():
        raise FileNotFoundError(
            f"Audio file not found: {input_path}"
        )

    output_dir = Path(
        tempfile.mkdtemp(prefix="lumen_whisperx_")
    )

    hf_token = get_token()

    if not hf_token:
        raise RuntimeError(
            "Hugging Face token not found. Run: hf auth login"
        )

    command = [
        sys.executable,
        "-m",
        "whisperx",
        str(input_path),
        "--model",
        "medium",
        "--device",
        "cpu",
        "--compute_type",
        "int8",
        "--output_dir",
        str(output_dir),
        "--diarize",
        "--min_speakers",
        "2",
        "--max_speakers",
        "2",
        "--hf_token",
        hf_token,
    ]

    print()
    print("Running WhisperX...")
    print()

    result = subprocess.run(
        command,
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr)

        raise RuntimeError(
            "WhisperX failed."
        )

    transcript_file = (
        output_dir / f"{input_path.stem}.txt"
    )

    if not transcript_file.exists():
        raise RuntimeError(
            f"WhisperX completed but transcript was not found:\n"
            f"{transcript_file}"
        )

    transcript = transcript_file.read_text(
        encoding="utf-8"
    ).strip()

    if not transcript:
        raise RuntimeError(
            "WhisperX returned an empty transcript."
        )

    return transcript


if __name__ == "__main__":

    if len(sys.argv) != 2:
        print()
        print("Usage:")
        print(
            'python audio_engine.py "path_to_audio_file"'
        )
        print()
        sys.exit(1)

    audio_file = sys.argv[1]

    try:
        transcript = transcribe_audio(audio_file)

        print()
        print("=" * 60)
        print("LUMEN AUDIO ENGINE OUTPUT")
        print("=" * 60)
        print()
        print(transcript)
        print()
        print("=" * 60)

    except Exception as e:
        print()
        print("ERROR:")
        print(e)
        sys.exit(1)