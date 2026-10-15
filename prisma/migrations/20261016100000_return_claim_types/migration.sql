-- Return claim categories (owner decision 2026-10-15, TASK-037 amendment).
ALTER TYPE "return_claim_type" ADD VALUE 'DEFECTIVE';
ALTER TYPE "return_claim_type" ADD VALUE 'EXPIRED';
ALTER TYPE "return_claim_type" ADD VALUE 'MISSING_ITEM';
