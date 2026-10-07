ALTER TABLE public.repatriations
ADD COLUMN IF NOT EXISTS release_instruction_id uuid NULL
REFERENCES public.release_instructions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_repatriations_release_instruction_id
ON public.repatriations(release_instruction_id);