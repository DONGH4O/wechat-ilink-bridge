## Summary

- 

## Validation

- [ ] `npm.cmd test` or `npm test`
- [ ] `npm.cmd run pack:dry-run` when packaging boundaries changed
- [ ] Secret-sensitive output reviewed

## Safety Checklist

- [ ] No `.env`, local state directories, live fixtures, or real stdout captures committed
- [ ] No complete bot tokens, context tokens, bearer headers, CDN signed URLs, or AES keys included
