-- KAN-246 read-only snapshot. Run only after every producer and outbox
-- dispatcher in the target environment has been stopped and its leases have
-- drained. The statement does not lock, update, normalize, or delete rows.
WITH pending_rows AS (
  SELECT id, queue_name, payload, message_attributes
  FROM public.job_outbox
  WHERE status = 'pending'
)
SELECT jsonb_build_object(
  'schemaVersion', 1,
  'rows', COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'queueName', queue_name,
        'payload', payload,
        'messageAttributes', message_attributes
      )
      ORDER BY id
    ),
    '[]'::jsonb
  )
)::text
FROM pending_rows;
