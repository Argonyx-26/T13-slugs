"""Module 4 starting point: Microsoft Presidio scrubber (runs on CPU).

    pip install presidio-analyzer presidio-anonymizer
    python -m spacy download en_core_web_lg      # use _lg: in our tests _sm missed "Ravi", "Lakshmi", "Arjun"

Deliberately NOT scrubbed: DATE_TIME (would turn "headache for 3 days" into
"headache for <DATE_TIME>"), NRP, LOCATION. Drug and symptom names are passed as
allow_terms so spaCy cannot mistake a drug for a person.
"""
ENTITIES = ["PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS", "IN_AADHAAR", "IN_PAN"]
# Without a threshold, Presidio's weak PAN patterns (score 0.01) replaced the word "prescribed"
# and a date like "2026-09-10" with <IN_PAN> in our tests. 0.4 keeps names, phones, valid
# Aadhaar/PAN numbers and emails, and leaves ordinary clinical text alone.
SCORE_THRESHOLD = 0.4


class PresidioPrivacy:
    name = "presidio"

    def __init__(self, settings, spacy_model: str = "en_core_web_lg"):
        self._spacy_model = spacy_model
        self._analyzer = None
        self._anonymizer = None

    def load(self) -> None:
        from presidio_analyzer import AnalyzerEngine
        from presidio_analyzer.nlp_engine import NlpEngineProvider
        from presidio_analyzer.predefined_recognizers import InAadhaarRecognizer, InPanRecognizer
        from presidio_anonymizer import AnonymizerEngine

        nlp = NlpEngineProvider(nlp_configuration={
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": self._spacy_model}]}).create_engine()
        self._analyzer = AnalyzerEngine(nlp_engine=nlp, supported_languages=["en"])
        for recognizer in (InAadhaarRecognizer(), InPanRecognizer()):   # India IDs are off by default
            self._analyzer.registry.add_recognizer(recognizer)
        self._anonymizer = AnonymizerEngine()

    def unload(self) -> None:
        self._analyzer = self._anonymizer = None

    def scrub_texts(self, texts: list[str], *, allow_terms: list[str],
                    deny_terms: list[str]) -> tuple[list[str], dict[str, int]]:
        from presidio_analyzer import PatternRecognizer
        ad_hoc = ([PatternRecognizer(supported_entity="PERSON", deny_list=deny_terms, name="known_names")]
                  if deny_terms else [])
        counts: dict[str, int] = {}
        out: list[str] = []
        for text in texts:
            results = self._analyzer.analyze(text=text, language="en", entities=ENTITIES,
                                             allow_list=allow_terms, ad_hoc_recognizers=ad_hoc,
                                             score_threshold=SCORE_THRESHOLD)
            anonymized = self._anonymizer.anonymize(text=text, analyzer_results=results)
            for item in anonymized.items:               # what was actually replaced
                counts[item.entity_type] = counts.get(item.entity_type, 0) + 1
            out.append(anonymized.text)
        return out, counts
