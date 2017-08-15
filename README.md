[graphql-sequelize](https://github.com/mickhansen/graphql-sequelize) v5.4.2

### Differences
- target engine node version ^7.0.0
- resolver: `useDataLoader` option
- resolver: generate includes if `options.include` is true
- resolver: use `dataloader-sequelize` if `options.include` is false or includes is not defined
- TypeMapper: support RANGE type
- TypeMapper: fix sanitized value first int
- relay connection: order by `JSONType`
- relay connection: `handleResult` hook
- relay connection: order by JSON/JSONB fields
- relay connection: order by associations
- relay connection: where JSON/JSONB fields
- relay connection: where associations
