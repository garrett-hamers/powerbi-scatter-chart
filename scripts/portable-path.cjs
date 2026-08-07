function portablePath(value) {
  return String(value).replaceAll("\\", "/");
}

module.exports = { portablePath };
