// 测试用的内存数据库：只实现 submitScore / getMyScore 用到的最小 API
//
// 行为尽量贴近 wx-server-sdk：
// - doc(id).get() 在文档不存在时抛错
// - add() 重复 _id 时抛错
// - where(condition).update(data) 只更新匹配文档，返回 stats.updated
// - serverDate() 返回 Date
// - add 使用 setImmediate 制造真实的异步交错，便于模拟并发

function createFakeDb(clock) {
  const collections = new Map();

  function docsOf(name) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name);
  }

  function matches(doc, condition) {
    return Object.keys(condition).every((key) => {
      const expected = condition[key];
      if (expected && expected.__op === "gt") {
        return doc[key] > expected.value;
      }
      return doc[key] === expected;
    });
  }

  return {
    command: {
      gt(value) {
        return { __op: "gt", value };
      },
    },

    serverDate() {
      return new Date(clock.now);
    },

    collection(name) {
      const docs = docsOf(name);
      return {
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
          return {
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
        },
      };
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
