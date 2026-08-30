const CommunicationLog = require('../database/models/CommunicationLog');
const SystemEvent = require('../database/models/SystemEvent');
const natsClient = require('./nats/natsClient');

const DistributedLogger = {
  // Logs inter-service communication (gRPC, REST, P2P)
  async logComm({ source, target, protocol = 'gRPC', operation, status = 'SUCCESS', details = '' }) {
    const formatted = `[COMM] [${protocol}] ${source} ➔ ${target} | ${operation} | Status: ${status} ${details ? `(${details})` : ''}`;
    if (status === 'SUCCESS') {
      console.log(formatted);
    } else {
      console.warn(formatted);
    }

    // Save to Database
    const logEntry = await CommunicationLog.log({
      source,
      target,
      protocol,
      operation,
      status,
      details: typeof details === 'object' ? JSON.stringify(details) : String(details),
    });

    // Broadcast over NATS
    natsClient.publish('comm.logs', {
      source,
      target,
      protocol,
      operation,
      status,
      details,
    });

    return logEntry;
  },

  // Logs system-wide domain events (MODEL_UPLOADED, REPLICATION_COMPLETED, etc.)
  async logEvent(eventType, source, payload = {}) {
    console.log(`[EVENT] [${eventType}] from ${source}:`, JSON.stringify(payload));

    // Save to Database
    const event = await SystemEvent.log(eventType, source, payload);

    // Publish to NATS
    natsClient.publish('system.events', {
      eventType,
      source,
      payload,
    });

    return event;
  },
};

module.exports = DistributedLogger;
