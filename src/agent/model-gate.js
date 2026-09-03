export class ModelCapacityError extends Error {
  constructor(message = "Model request capacity is temporarily full") {
    super(message);
    this.name = "ModelCapacityError";
  }
}

export function createModelGate(client, { maxConcurrent = 2, maxQueued = 20 } = {}) {
  let active = 0;
  const queue = [];

  function acquire() {
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    if (queue.length >= maxQueued) return Promise.reject(new ModelCapacityError());
    return new Promise((resolve) => queue.push(resolve));
  }

  function release() {
    const next = queue.shift();
    if (next) {
      next();
      return;
    }
    active -= 1;
  }

  return Object.freeze({
    get configured() {
      return Boolean(client?.configured);
    },
    get model() {
      return client?.model;
    },
    async createStructured(request) {
      await acquire();
      try {
        return await client.createStructured(request);
      } finally {
        release();
      }
    },
  });
}
