// 测试用的内存数据库：实现 M2 / M3 用到的最小 API
//
// 行为尽量贴近 wx-server-sdk：
// - doc(id).get() 在文档不存在时抛错
// - add() 重复 _id 时抛错
// - where(condition).update(data) 只更新匹配文档，返回 stats.updated
// - serverDate() 返回 Date
// - add 使用 setImmediate 制造真实的异步交错，便于模拟并发
//
// M3 额外支持：
// - command.lt / gt / eq（用于排名条件计数与上一名查询）
// - where(...).orderBy(...).skip(...).limit(...).get() / count()
// - collection.orderBy(...).limit(...).get() / count()
// - seed(name, docs)：同步写入测试数据
// - get(name, id) / size(name)：直接读取测试数据

function createFakeDb(clock) {
  const collections = new Map();

  function docsOf(name) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name);
  }

  function toComparable(value) {
    if (value instanceof Date) {
      return value.getTime();
    }
    return value;
  }

  function compareValues(left, right) {
    const a = toComparable(left);
    const b = toComparable(right);
    if (typeof a === "number" && typeof b === "number") {
      return a - b;
    }
    const sa = a === undefined || a === null ? "" : String(a);
    const sb = b === undefined || b === null ? "" : String(b);
    if (sa < sb) return -1;
    if (sa > sb) return 1;
    return 0;
  }

  function matchesValue(actual, expected) {
    if (expected && expected.__op === "gt") {
      return compareValues(actual, expected.value) > 0;
    }
    if (expected && expected.__op === "lt") {
      return compareValues(actual, expected.value) < 0;
    }
    if (expected && expected.__op === "eq") {
      return compareValues(actual, expected.value) === 0;
    }
    return compareValues(actual, expected) === 0;
  }

  function matches(doc, condition) {
    if (!condition || Object.keys(condition).length === 0) {
      return true;
    }
    return Object.keys(condition).every((key) =>
      matchesValue(doc[key], condition[key])
    );
  }

  function createQuery(docs, condition, state) {
    const options = state || {};
    const orders = options.orders || [];
    const skip = options.skip || 0;
    const limit = options.limit === undefined ? null : options.limit;

    function select() {
      let list = Array.from(docs.values()).filter((doc) =>
        matches(doc, condition)
      );

      if (orders.length > 0) {
        list.sort((a, b) => {
          for (const order of orders) {
            const cmp = compareValues(a[order.field], b[order.field]);
            if (cmp !== 0) {
              return order.direction === "desc" ? -cmp : cmp;
            }
          }
          return 0;
        });
      }

      const start = skip;
      const end = limit === null ? undefined : start + limit;
      return list.slice(start, end).map((doc) => ({ ...doc }));
    }

    return {
      orderBy(field, direction) {
        return createQuery(docs, condition, {
          ...options,
          orders: orders.concat({
            field,
            direction: direction === "desc" ? "desc" : "asc",
          }),
        });
      },

      skip(count) {
        return createQuery(docs, condition, {
          ...options,
          skip: Math.max(0, Number(count) || 0),
        });
      },

      limit(count) {
        return createQuery(docs, condition, {
          ...options,
          limit: Math.max(0, Number(count) || 0),
        });
      },

      async get() {
        return { data: select() };
      },

      async count() {
        // count 不受 skip / limit 影响，只统计匹配文档
        return {
          total: Array.from(docs.values()).filter((doc) =>
            matches(doc, condition)
          ).length,
        };
      },

      async update({ data }) {
        let updated = 0;
        docs.forEach((doc) => {
          if (matches(doc, condition)) {
            Object.assign(doc, data);
            updated += 1;
          }
        });
        return { stats: { updated } };
      },
    };
  }

  return {
    command: {
      gt(value) {
        return { __op: "gt", value };
      },
      lt(value) {
        return { __op: "lt", value };
      },
      eq(value) {
        return { __op: "eq", value };
      },
    },

    serverDate() {
      return new Date(clock.now);
    },

    collection(name) {
      const docs = docsOf(name);
      const base = createQuery(docs, {});

      return {
        ...base,

        doc(id) {
          return {
            async get() {
              if (!docs.has(id)) {
                const err = new Error("document does not exist");
                err.errCode = -1;
                throw err;
              }
              return { data: { ...docs.get(id) } };
            },
            async update({ data }) {
              if (!docs.has(id)) {
                return { stats: { updated: 0 } };
              }
              Object.assign(docs.get(id), data);
              return { stats: { updated: 1 } };
            },
          };
        },

        add({ data }) {
          return new Promise((resolve, reject) => {
            setImmediate(() => {
              if (docs.has(data._id)) {
                const err = new Error("duplicate _id");
                err.errCode = -502001;
                reject(err);
                return;
              }
              docs.set(data._id, { ...data });
              resolve({ _id: data._id });
            });
          });
        },

        where(condition) {
          return createQuery(docs, condition || {});
        },
      };
    },

    seed(name, docs) {
      const store = docsOf(name);
      (docs || []).forEach((doc) => {
        if (!doc || !doc._id) return;
        store.set(doc._id, { ...doc });
      });
    },

    get(name, id) {
      const docs = docsOf(name);
      return docs.has(id) ? docs.get(id) : null;
    },

    size(name) {
      return docsOf(name).size;
    },
  };
}

module.exports = { createFakeDb };
