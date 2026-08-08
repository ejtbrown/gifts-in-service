BEGIN;

ALTER TABLE pending_interviews
  DROP CONSTRAINT IF EXISTS pending_interviews_role_safety_concerns_shape;

ALTER TABLE pending_interviews
  ADD CONSTRAINT pending_interviews_role_safety_concerns_shape
  CHECK (
    jsonb_typeof(role_safety_concerns) = 'array'
    AND jsonb_array_length(role_safety_concerns) <= 13
    AND role_safety_concerns <@ '["INFANT_CARE","CHILD_SUPERVISION","VULNERABLE_ADULT_CARE","PASSENGER_TRANSPORT","FINANCIAL_HANDLING","PASTORAL_COUNSELING","HOME_VISITATION","FOOD_SERVICE","MEDICAL_FIRST_AID","FACILITIES_EQUIPMENT","SECURITY_EMERGENCY_RESPONSE","SENSITIVE_INFORMATION_ACCESS","GENERAL_ROLE_SAFETY"]'::jsonb
  );

COMMIT;
