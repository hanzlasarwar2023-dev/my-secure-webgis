INSERT INTO public.places (name, category, geom)
SELECT name, 'Department', ST_SetSRID(ST_MakePoint(lon, lat), 4326)
FROM (VALUES
  ('CEES PU', 74.295113, 31.497080),
  ('Faculty of Agricultural Sciences', 74.297059, 31.495211),
  ('Institute of Quality & Technology Management (IQTM)', 74.301023, 31.496343),
  ('Hailey College of Commerce', 74.303134, 31.497125),
  ('Jamia Masjid, Punjab University', 74.304655, 31.498235),
  ('PUNJAB UNIVERSITY LIBRARY', 74.305532, 31.499820),
  ('School Of Chemistry', 74.306807, 31.501099),
  ('Department of Geography', 74.308436, 31.502071),
  ('University Laboratory School', 74.310150, 31.503084),
  ('Institute of Education & Research', 74.309317, 31.503736),
  ('PC Shopping Center', 74.303233, 31.506275),
  ('Punjab University Club', 74.300160, 31.503963),
  ('PU Seed Research Center', 74.300693, 31.501402),
  ('Honey Bee Research Program', 74.296992, 31.497909),
  ('Punjab University Fish Farms ',74.293591, 31.498136),
  ('Punjab University Graveyard', 74.298822, 31.496459)
) AS v(name, lon, lat);