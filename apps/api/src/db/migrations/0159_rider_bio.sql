-- A short "about me" a rider writes for customers to read on their profile when choosing a rider.
-- Applied by hand. Until it is, the profile simply has no bio (the API checks for the column).
-- Numbered 0159, not 0158: 0158_learn_creator.sql is already applied on production and
-- recorded under that filename in d1_migrations. Do not rename that file.
-- If riders.bio already exists from a hand run of the old 0158_rider_bio.sql name, skip this file.
ALTER TABLE riders ADD COLUMN bio TEXT;
