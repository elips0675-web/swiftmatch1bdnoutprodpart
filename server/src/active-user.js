export function activeUser(alias) {
  return `EXISTS (SELECT 1 FROM users su WHERE su.id = ${alias}.id AND su.is_active = 1 AND su.deleted_at IS NULL)`
}
