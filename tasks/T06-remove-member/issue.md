# Let members leave a group, and let the owner remove them

Right now nobody can ever leave a group. Our roommate moved out and still shows up in every split.

## Requirements

Add `DELETE /groups/:id/members/:userId`:

- The owner can remove any member except themselves. Any member can remove themselves (leave).
  Anyone else gets 403. Non-members get 404 for the group, as usual.
- The owner can't leave their own group: 400.
- Removing someone who isn't a member: 404.
- A member whose balance isn't zero can't leave or be removed: 409. They settle up first.
- Success is 204.

After someone has left:

- They no longer appear in the group's members or balances, they can't see the group (404), and
  new expenses aren't split with them (by default or via `splitAmong`).
- **History stays intact.** Past expenses still show their share, and the shares of every past
  expense still add up to its amount.
- The owner can add them back later with `POST /groups/:id/members`.

This is live with real data, so it has to work on the existing database.
