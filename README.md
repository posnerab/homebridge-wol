# homebridge-wol

Homebridge plugin that exposes a switch for sending a Wake-on-LAN magic packet.

When you turn the switch on in HomeKit, the plugin sends the packet and then automatically flips the switch back off a few seconds later.

## Config behavior

The plugin accepts either of these:

- `macAddress` only: best when you already know the target MAC
- `host` only: the plugin resolves the host and tries to discover the MAC from the Homebridge machine's neighbor table
- `host` and `macAddress`: most reliable, and recommended

You must provide at least one of `host` or `macAddress`.

## Test config for your machine

```json
{
  "platforms": [
    {
      "platform": "MiniSefarimWolPlatform",
      "name": "Mini Sefarim",
      "host": "192.168.1.223",
      "macAddress": "1c:83:41:33:84:03",
      "broadcastAddress": "255.255.255.255",
      "port": 9,
      "resetDelayMs": 3000
    }
  ]
}
```

## Other config examples

MAC only:

```json
{
  "platform": "MiniSefarimWolPlatform",
  "name": "Office PC",
  "macAddress": "1c:83:41:33:84:03"
}
```

Host only:

```json
{
  "platform": "MiniSefarimWolPlatform",
  "name": "Office PC",
  "host": "192.168.1.223"
}
```

## Config options

- `platform`: Must be `MiniSefarimWolPlatform`
- `name`: Display name for the HomeKit switch
- `host`: Hostname or IP address to resolve for MAC auto-discovery
- `ipAddress`: Alias for `host`
- `macAddress`: Target MAC address used for the magic packet
- `broadcastAddress`: Usually `255.255.255.255`
- `port`: Usually `9` or `7`
- `resetDelayMs`: How long the switch stays on before resetting

## Install

```bash
npm install
```

Then add one of the config examples above to your Homebridge `config.json`.

## Notes

- `macAddress` is the most reliable option because Wake-on-LAN ultimately depends on the MAC, not the IP.
- If `macAddress` is omitted, the plugin tries `ip neigh` and `arp -n` on the Homebridge host.
- If the target is already asleep and its MAC is not cached locally, host-only discovery can fail.
