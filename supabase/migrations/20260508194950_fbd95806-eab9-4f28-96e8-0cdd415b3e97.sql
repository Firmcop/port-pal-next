-- Add 'free' status to org_status enum
ALTER TYPE public.org_status ADD VALUE IF NOT EXISTS 'free';
