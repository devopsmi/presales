module.exports = {
  apps: [
    {
      name: "presales",
      script: "pnpm",
      args: "start",
      env: {
        PORT: 4001
      },
      autorestart: true,
      watch: false
    }
  ]
};
