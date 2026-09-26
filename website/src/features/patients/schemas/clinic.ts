import { z } from 'zod';

// ============================================================
// Clinic tier write contracts, validated on the server
// ============================================================
// Ranges match the backend's SQL checks (backend/sql/01_schema.sql, 06_risk.sql),
// so anything the dashboard accepts, the database accepts too.
// ============================================================

const text = (max: number) => z.string().trim().min(1).max(max);
const list = (max: number) => z.array(text(120)).max(max);
const reading = (min: number, max: number) => z.number().min(min).max(max).nullable();
const whole = (min: number, max: number) => z.number().int().min(min).max(max).nullable();

export const vitalsSchema = z.object({
  systolic_bp: whole(40, 300),
  diastolic_bp: whole(20, 200),
  heart_rate: whole(20, 250),
  resp_rate: whole(4, 70),
  temperature_c: reading(30, 45),
  spo2: whole(50, 100),
  on_oxygen: z.boolean(),
  consciousness: z.enum(['alert', 'new_confusion', 'voice', 'pain', 'unresponsive']).nullable(),
  blood_glucose: whole(10, 1000),
  weight_kg: reading(1, 400)
});

export const registerPatientSchema = z
  .object({
    full_name: text(120),
    phone: z
      .string()
      .trim()
      .max(20)
      .regex(/^[+\d\s()-]*$/, 'Digits only')
      .transform((p) => p.replace(/\D/g, '') || null)
      .nullable(),
    age: whole(0, 130),
    sex: z.enum(['M', 'F', 'O']).nullable(),
    allergies: list(20),
    no_known_allergies: z.boolean(),
    conditions: list(20),
    medications: list(30),
    check_in: z.boolean(),
    allow_duplicate: z.boolean()
  })
  .refine((v) => !(v.allergies.length && v.no_known_allergies), {
    message: "Allergies are listed but 'No known allergies' is also ticked",
    path: ['no_known_allergies']
  });

export const checkInSchema = z.object({
  patient_id: text(64),
  complaint: z.array(text(200)).max(10),
  vitals: vitalsSchema.nullable()
});

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((d) => !Number.isNaN(Date.parse(d)), 'Not a real date');

export const addClinicRecordSchema = z.object({
  patient_id: text(64),
  record_type: z.enum(['allergy', 'diagnosis', 'prescription', 'lab', 'visit']),
  content: text(500),
  recorded_on: isoDate
});

export const retractClinicRecordSchema = z.object({
  patient_id: text(64),
  record_id: text(64),
  reason: z.enum(['entered_in_error', 'stopped']),
  note: z.string().trim().max(300).nullable()
});
