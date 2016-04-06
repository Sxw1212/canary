var r = require("./db");
var ourUUID = require("node-uuid")();

var electionTimeout = false;
var leader = false;

r.changesRecon(r.db("canary").table("leaderElection").changes(), function(row) {
  electionTimeout = true;
  // Here we assume RethinkDB has atomic order.
  if (row.new_val && row.new_val.leader == ourUUID) {
    leader = true;
    // Clear table to keep database size in check
    r.db("canary").table("leaderElection").delete().run();
  } else if (row.new_val && row.new_val.leader != ourUUID) {
    leader = false;
  }
});

setInterval(function() {
  if (leader) {
    r.db("canary").table("leaderElection").insert({
      leader: ourUUID,
      time: r.now()
    }).run();
  }
}, 1000 * 30);

setInterval(function() {
  if (!electionTimeout) {
    r.db("canary").table("leaderElection").insert({
      leader: ourUUID,
      time: r.now()
    }).run();
  }

  electionTimeout = false;

  if (leader) {
    console.log("I am leader this cycle, let's do this.");
    r.db("canary").table("rooms").run({cursor: true}).then(function(cursor) {

      var roomTiers = {};

      cursor.eachAsync(function(room, roomFinished) {

        var usersInRoom = 0;
        var voteGrow = 0;

        r.db("canary").table("accounts").filter({
          currentRoom: room.id
        }).run({cursor: true}).then(function(cursor) {
          cursor.eachAsync(function(user, userFinished) {
            usersInRoom++;
            if (user.voteGrow) {
              voteGrow++;
            }
            console.log(userFinished);
          }).then(function() {
            if (usersInRoom > 0 && voteGrow > (usersInRoom / 2)) {
              r.db("canary").table("accounts").filter({
                currentRoom: roomTiers[room.id]
              }).update({
                currentRoom: room.id
              }).run();

              r.db("canary").table("rooms").get(room.id).update({
                tier: room.tier + 1
              }).run().then(roomFinished);

              delete roomTiers[room.id];
            } else {
              r.db("canary").table("rooms").get(room.id).delete().run().then(roomFinished);
            }
          });
        });
      });
    });
  }
}, 1000 * 60);