import Redis from "ioredis";

let redis: Redis;

declare global {
  var __redis__: Redis | undefined;
}

if (process.env.NODE_ENV === "production") {
  redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
} else {
  if (!global.__redis__) {
    global.__redis__ = new Redis(
      process.env.REDIS_URL || "redis://127.0.0.1:6379"
    );
  }
  redis = global.__redis__;
}

export { redis };
