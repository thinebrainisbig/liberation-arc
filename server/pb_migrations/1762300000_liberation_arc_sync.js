/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.createRule = null;                 // no public sign-up (open by default)
  users.listRule = "id = @request.auth.id";
  users.viewRule = "id = @request.auth.id";
  users.authToken.duration = 2592000;      // 30 days; the app refreshes it on launch
  app.save(users);

  const own = '@request.auth.id != "" && owner = @request.auth.id';
  app.save(new Collection({
    type: "base",
    name: "kv",
    listRule: own,
    viewRule: own,
    createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id',
    updateRule: own + ' && (@request.body.owner:isset = false || @request.body.owner = @request.auth.id)',
    deleteRule: null,                        // deletions are tombstones, never real deletes
    fields: [
      { name: "owner", type: "relation", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "key", type: "text", required: true, max: 200 },
      { name: "value", type: "json", maxSize: 10485760 },
      { name: "clientUpdatedAt", type: "number", required: true, onlyInt: true },
      { name: "deleted", type: "bool" },
      { name: "deviceId", type: "text", max: 64 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_kv_owner_key ON kv (owner, `key`)",
      "CREATE INDEX idx_kv_updated ON kv (updated)",
    ],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("kv"));
});
