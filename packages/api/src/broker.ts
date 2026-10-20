import amqp, { type ChannelModel, type ConfirmChannel } from "amqplib";
import { z } from "zod";

const envelope = z
  .object({ kind: z.enum(["memory", "email"]), id: z.uuid() })
  .strict();
export type JobEnvelope = z.infer<typeof envelope>;
const queueName = "grove.jobs.v1";

/** The broker carries opaque job IDs. PostgreSQL remains the transactional outbox. */
export class JobBroker {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private pending = new Set<Promise<void>>();
  private consumer?: string;
  get connected() {
    return !!this.channel;
  }
  constructor(
    private url: string,
    private concurrency: number,
    private run: (job: JobEnvelope) => Promise<void>,
  ) {}
  async connect() {
    if (this.channel) return;
    await this.connection?.close().catch(() => {});
    const connection = await amqp.connect(this.url, {
      timeout: 10000,
      clientProperties: { connection_name: "grove-worker" },
    });
    this.connection = connection;
    connection.on("error", () => {
      /* Reconnect from the worker loop; never log credential-bearing errors. */
    });
    connection.on("close", () => {
      if (this.connection === connection) {
        this.channel = undefined;
        this.connection = undefined;
      }
    });
    try {
      const channel = await connection.createConfirmChannel();
      channel.on("error", () => {});
      channel.on("close", () => {
        if (this.channel === channel) this.channel = undefined;
      });
      await channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          "x-message-ttl": 3600000,
          "x-max-length": 10000,
          "x-overflow": "reject-publish",
        },
      });
      await channel.prefetch(this.concurrency);
      const consumer = await channel.consume(queueName, (message) => {
        if (!message) return;
        const task = (async () => {
          try {
            const parsed = envelope.safeParse(
              JSON.parse(message.content.toString()),
            );
            if (parsed.success) await this.run(parsed.data);
            // Retry state is kept in the database, preventing broker retry storms.
            channel.ack(message);
          } catch {
            try {
              channel.nack(message, false, false);
            } catch {
              /* Connection already closed. */
            }
          }
        })();
        this.pending.add(task);
        void task.finally(() => this.pending.delete(task));
      });
      this.consumer = consumer.consumerTag;
      this.channel = channel;
    } catch (error) {
      await connection.close().catch(() => {});
      throw error;
    }
  }
  async publish(job: JobEnvelope) {
    const channel = this.channel;
    if (!channel) throw new Error("broker_unavailable");
    await new Promise<void>((resolve, reject) =>
      channel.sendToQueue(
        queueName,
        Buffer.from(JSON.stringify(job)),
        {
          persistent: true,
          contentType: "application/json",
          messageId: job.id,
        },
        (error) =>
          error ? reject(new Error("broker_publish_failed")) : resolve(),
      ),
    );
  }
  async close() {
    if (this.consumer && this.channel)
      await this.channel.cancel(this.consumer).catch(() => {});
    await Promise.allSettled([...this.pending]);
    await this.connection?.close().catch(() => {});
    this.channel = undefined;
  }
}
