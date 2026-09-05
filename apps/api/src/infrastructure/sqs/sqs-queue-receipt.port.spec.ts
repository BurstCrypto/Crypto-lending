import type { JobEnvelope } from '../outbox/job-envelope';
import {
  PinnedSqsQueueReceiptAdapter,
  type SqsQueueReceiptTransport,
} from './sqs-queue-receipt.port';
import type { ReceivedQueueMessage } from './sqs.types';

const SOURCE_QUEUE_URL =
  'https://sqs.us-east-1.amazonaws.com/000000000000/crypto-lending-test-balance-sync';

function transport(): SqsQueueReceiptTransport & {
  receive: jest.Mock;
  delete: jest.Mock;
  changeVisibility: jest.Mock;
  parseEnvelope: jest.Mock;
} {
  return {
    receive: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue(undefined),
    changeVisibility: jest.fn().mockResolvedValue(undefined),
    parseEnvelope: jest.fn().mockReturnValue({ kind: 'blockchain.balance-sync' }),
  };
}

describe('PinnedSqsQueueReceiptAdapter', () => {
  it('captures its transport and source URL in frozen true-private state', () => {
    const underlying = transport();
    const receipt = new PinnedSqsQueueReceiptAdapter(underlying, SOURCE_QUEUE_URL);

    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Reflect.ownKeys(receipt)).toEqual([]);
    expect(receipt).not.toHaveProperty('queueUrl');
    expect(receipt).not.toHaveProperty('transport');
    expect(receipt).not.toHaveProperty('sendJob');
    expect(receipt).not.toHaveProperty('publish');
    expect(receipt).not.toHaveProperty('publishBatch');
    expect(receipt).not.toHaveProperty('healthCheck');
  });

  it('pins receive, visibility, and deletion to one construction-selected source', async () => {
    const underlying = transport();
    const receipt = new PinnedSqsQueueReceiptAdapter(underlying, SOURCE_QUEUE_URL);
    const signal = new AbortController().signal;
    const message: ReceivedQueueMessage = {
      messageId: 'message-1',
      receiptHandle: 'receipt-1',
      body: '{}',
      receiveCount: 1,
      receivedAtMonotonicMs: 1,
    };

    await receipt.receive(2, 7, signal);
    await receipt.changeVisibility(message, 30, signal);
    await receipt.delete(message, signal);

    expect(underlying.receive).toHaveBeenCalledWith(SOURCE_QUEUE_URL, 2, 7, signal);
    expect(underlying.changeVisibility).toHaveBeenCalledWith(message, 30, SOURCE_QUEUE_URL, signal);
    expect(underlying.delete).toHaveBeenCalledWith(message, SOURCE_QUEUE_URL, signal);
  });

  it('never treats caller input as a queue URL', async () => {
    const underlying = transport();
    const receipt = new PinnedSqsQueueReceiptAdapter(underlying, SOURCE_QUEUE_URL);
    const attackerQueue =
      'https://sqs.us-east-1.amazonaws.com/999999999999/attacker-controlled-queue';

    await (receipt.receive as unknown as (value: string) => Promise<unknown>)(attackerQueue);

    expect(underlying.receive).toHaveBeenCalledWith(SOURCE_QUEUE_URL, attackerQueue, 10, undefined);
    expect(underlying.receive).not.toHaveBeenCalledWith(attackerQueue);
  });

  it('forwards parsing without adding a publication capability', () => {
    const underlying = transport();
    const expected = { kind: 'blockchain.balance-sync' } as JobEnvelope;
    underlying.parseEnvelope.mockReturnValue(expected);
    const receipt = new PinnedSqsQueueReceiptAdapter(underlying, SOURCE_QUEUE_URL);

    expect(receipt.parseEnvelope('{"kind":"blockchain.balance-sync"}')).toBe(expected);
    expect(underlying.parseEnvelope).toHaveBeenCalledWith('{"kind":"blockchain.balance-sync"}');
  });

  it.each([undefined, null, '', ' ', ` ${SOURCE_QUEUE_URL}`, `${SOURCE_QUEUE_URL} `])(
    'rejects an invalid construction-time source queue: %p',
    (queueUrl) => {
      expect(
        () => new PinnedSqsQueueReceiptAdapter(transport(), queueUrl as unknown as string),
      ).toThrow('Pinned SQS source queue URL is invalid');
    },
  );
});
