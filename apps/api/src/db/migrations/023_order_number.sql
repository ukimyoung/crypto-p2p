-- Order numbers people can read: the order date in Korea time (YYYYMMDD) and a sequence
-- that starts again at 0001 every day, e.g. 202610260001. The uuid stays the primary key.
-- Past 9999 orders in a day the sequence simply grows to five digits (2026102610000).

CREATE TABLE order_number_counters (
  day   date PRIMARY KEY,
  last  int  NOT NULL
);

-- Takes the next number for the Korea-time day of `at`. The counter row stays locked until
-- the order's transaction ends, so concurrent orders never share a number, and a rolled
-- back order gives its number back instead of leaving a gap.
CREATE FUNCTION next_order_number(at timestamptz) RETURNS text
LANGUAGE sql AS $$
  INSERT INTO order_number_counters AS c (day, last)
  VALUES ((at AT TIME ZONE 'Asia/Seoul')::date, 1)
  ON CONFLICT (day) DO UPDATE SET last = c.last + 1
  RETURNING to_char(day, 'YYYYMMDD') || lpad(last::text, greatest(4, length(last::text)), '0')
$$;

ALTER TABLE orders ADD COLUMN order_number text;

-- Number existing orders in the order they were placed.
WITH numbered AS (
  SELECT id,
         (created_at AT TIME ZONE 'Asia/Seoul')::date AS day,
         row_number() OVER (PARTITION BY (created_at AT TIME ZONE 'Asia/Seoul')::date ORDER BY created_at, id) AS seq
  FROM orders
)
UPDATE orders o
SET order_number = to_char(n.day, 'YYYYMMDD') || lpad(n.seq::text, greatest(4, length(n.seq::text)), '0')
FROM numbered n
WHERE n.id = o.id;

INSERT INTO order_number_counters (day, last)
SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date, count(*)
FROM orders
GROUP BY 1;

ALTER TABLE orders ALTER COLUMN order_number SET NOT NULL;
ALTER TABLE orders ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);
