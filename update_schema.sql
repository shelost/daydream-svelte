-- Update the pages table to allow 'diagram' as a valid page type
ALTER TABLE pages
DROP CONSTRAINT pages_type_check;

ALTER TABLE pages
ADD CONSTRAINT pages_type_check
CHECK (type IN ('canvas', 'drawing', 'diagram'));