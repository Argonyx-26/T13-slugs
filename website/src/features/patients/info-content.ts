import type { InfobarContent } from '@/components/ui/infobar';

export const patientsInfoContent: InfobarContent = {
  title: 'How risk is shown',
  sections: [
    {
      title: 'Where the risk comes from',
      description:
        "Each patient's risk is the highest likelihood among the possible outcomes flagged from their stored record: documented allergies, drug interactions, lab trends and conflicting records. The rule engine and the AI review both contribute, and every flag cites the records it rests on.",
      links: []
    },
    {
      title: 'Reading the tiles',
      description:
        'High-risk patients get the large tiles, moderate risk the wide ones. The three-step meter and the icon plus label carry the level; colour never does on its own. "Not assessed" means there is nothing on record to check yet, which is different from low risk.',
      links: []
    },
    {
      title: 'Allergy status',
      description:
        'A blank allergy record is shown as "unknown", never as "no allergies". When two records disagree, the allergy is treated as present until the records are reconciled.',
      links: []
    },
    {
      title: 'Not a diagnosis',
      description:
        'Flags describe what may happen and why, from the records. They are not a diagnosis, advice or a treatment recommendation; the doctor makes every clinical decision.',
      links: []
    }
  ]
};
