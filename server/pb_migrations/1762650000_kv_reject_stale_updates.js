/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const kv = app.findCollectionByNameOrId("kv");
  const own = '@request.auth.id != "" && owner = @request.auth.id';
  kv.updateRule = own + ' && (@request.body.owner:isset = false || @request.body.owner = @request.auth.id)' +
    ' && @request.body.clientUpdatedAt > clientUpdatedAt';
  app.save(kv);
}, (app) => {
  const kv = app.findCollectionByNameOrId("kv");
  const own = '@request.auth.id != "" && owner = @request.auth.id';
  kv.updateRule = own + ' && (@request.body.owner:isset = false || @request.body.owner = @request.auth.id)';
  app.save(kv);
});
