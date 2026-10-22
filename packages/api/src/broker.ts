import amqp, {
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
} from "amqplib";
import { z } from "zod";
import type { QueueLane } from "@lib/shared/jobs";

const envelope = z
  .object({ kind: z.enum(["memory", "email", "task"]), id: z.uuid() })
  .strict();
export type JobEnvelope = z.infer<typeof envelope>;
export const queueName = (lane: QueueLane) => `grove.jobs.v2.${lane}`;
const limits = {
  "x-message-ttl": 3600000,
  "x-max-length": 10000,
  "x-overflow": "reject-publish",
};

/** PostgreSQL owns retries and leases; each lane has independent broker credit. */
export class JobBroker {
  private connection?: ChannelModel;
  private publisher?: ConfirmChannel;
  private consumers: { channel: Channel; tag: string }[] = [];
  private pending = new Set<Promise<void>>();
  private closing = false;
  get connected() {
    return !!this.publisher && !this.closing;
  }
  constructor(
    private url: string,
    private capacities: Partial<Record<QueueLane, number>>,
    private run: (job: JobEnvelope, lane?: QueueLane) => Promise<unknown>,
    private legacy = true,
  ) {}
  async connect() {
    if (this.connected || this.closing) return;
    await this.connection?.close().catch(() => {});
    const connection = await amqp.connect(this.url, {
      timeout: 10000,
      clientProperties: { connection_name: "grove-worker" },
    });
    this.connection = connection;
    connection.on("error", () => {});
    connection.on("close", () => {
      if (this.connection === connection) {
        this.publisher = undefined;
        this.connection = undefined;
        this.consumers = [];
      }
    });
    try {
      const publisher = await connection.createConfirmChannel();
      publisher.on("error", () => {});
      publisher.on("close", () => {
        if (this.publisher === publisher) this.publisher = undefined;
      });
      const consume = async (
        name: string,
        capacity: number,
        lane?: QueueLane,
      ) => {
        const channel = await connection.createChannel();
        channel.on("error", () => {});
        channel.on("close", () => {
          if (!this.closing && this.connection === connection)
            this.publisher = undefined;
        });
        await channel.assertQueue(name, { durable: true, arguments: limits });
        await channel.prefetch(capacity);
        const consumer = await channel.consume(name, (message) => {
          if (!message) return;
          const task = (async () => {
            try {
              const parsed = envelope.safeParse(
                JSON.parse(message.content.toString()),
              );
              if (parsed.success && !this.closing)
                await this.run(parsed.data, lane);
              channel.ack(message);
            } catch {
              try {
                channel.nack(message, false, false);
              } catch {
                /* Disconnected: durable state redispatches. */
              }
            }
          })();
          this.pending.add(task);
          void task.finally(() => this.pending.delete(task));
        });
        this.consumers.push({ channel, tag: consumer.consumerTag });
      };
      for (const [lane, capacity] of Object.entries(this.capacities)) {
        if (capacity > 0)
          await consume(
            queueName(lane as QueueLane),
            capacity,
            lane as QueueLane,
          );
      }
      if (this.legacy) await consume("grove.jobs.v1", 1);
      this.publisher = publisher;
    } catch (error) {
      await connection.close().catch(() => {});
      throw error;
    }
  }
  async publish(job: JobEnvelope, lane: QueueLane) {
    const channel = this.publisher;
    if (!channel || this.closing) throw new Error("broker_unavailable");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("broker_confirm_timeout")),
        10000,
      );
      try {
        channel.sendToQueue(
          queueName(lane),
          Buffer.from(JSON.stringify(job)),
          {
            persistent: true,
            contentType: "application/json",
            messageId: job.id,
          },
          (error) => {
            clearTimeout(timer);
            if (error) reject(new Error("broker_publish_failed"));
            else resolve();
          },
        );
      } catch {
        clearTimeout(timer);
        reject(new Error("broker_unavailable"));
      }
    });
  }
  async disconnect() {
    this.publisher = undefined;
    await this.connection?.close().catch(() => {});
    this.consumers = [];
  }
  async close() {
    this.closing = true;
    await Promise.allSettled(
      this.consumers.map(({ channel, tag }) => channel.cancel(tag)),
    );
    await Promise.allSettled([...this.pending]);
    await this.disconnect();
  }
}
