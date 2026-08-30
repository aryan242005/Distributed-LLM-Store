const { connect, JSONCodec } = require('nats');
const EventEmitter = require('events');
const config = require('../../config/config');

class NatsClientService extends EventEmitter {
  constructor() {
    super();
    this.nc = null;
    this.jc = JSONCodec();
    this.isConnected = false;
  }

  async connect() {
    try {
      this.nc = await connect({
        servers: [config.nats.url],
        timeout: 3000,
        maxReconnectAttempts: 5,
        reconnectTimeWait: 1000,
      });

      this.isConnected = true;
      console.log(`[NATS] Connected to NATS broker at ${config.nats.url}`);

      // Setup listeners for important subjects
      this.subscribe('system.events', (data) => {
        this.emit('system.event', data);
      });

      this.subscribe('node.events', (data) => {
        this.emit('node.event', data);
      });

      this.subscribe('replication.events', (data) => {
        this.emit('replication.event', data);
      });

      return true;
    } catch (err) {
      console.warn(`[NATS] Could not connect to NATS broker (${err.message}). Using local In-Memory Event Bus.`);
      this.isConnected = false;
      return false;
    }
  }

  async publish(subject, data) {
    const payload = {
      ...data,
      timestamp: new Date().toISOString()
    };

    if (this.isConnected && this.nc) {
      try {
        this.nc.publish(subject, this.jc.encode(payload));
      } catch (err) {
        console.error(`[NATS] Publish error on ${subject}:`, err.message);
      }
    }

    // Always emit on local emitter as well
    this.emit(subject, payload);
    this.emit('any', { subject, payload });
  }

  subscribe(subject, callback) {
    if (this.isConnected && this.nc) {
      try {
        const sub = this.nc.subscribe(subject);
        (async () => {
          for await (const msg of sub) {
            try {
              const data = this.jc.decode(msg.data);
              callback(data);
            } catch (e) {
              console.error('[NATS Sub Error]', e);
            }
          }
        })().catch(err => console.error('[NATS Subscription Loop Error]', err));
      } catch (err) {
        console.error(`[NATS] Subscribe error on ${subject}:`, err.message);
      }
    }

    // Local subscription
    this.on(subject, callback);
  }

  async close() {
    if (this.nc) {
      await this.nc.drain();
      this.isConnected = false;
    }
  }
}

const natsClient = new NatsClientService();
module.exports = natsClient;
