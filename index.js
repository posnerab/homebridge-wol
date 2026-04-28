const dns = require("dns").promises;
const dgram = require("dgram");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const PLUGIN_NAME = "homebridge-wol";
const PLATFORM_NAME = "MiniSefarimWolPlatform";
const ACCESSORY_INFORMATION = {
  manufacturer: "xander",
  model: "Wake on LAN Switch",
  serialNumber: "wol-switch",
};

module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, MiniSefarimWolPlatform);
};

class MiniSefarimWolPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.accessories = [];

    this.host = this.config.host || this.config.ipAddress || null;
    this.name = this.config.name || "Wake on LAN";
    this.port = Number(this.config.port || 9);
    this.broadcastAddress = this.config.broadcastAddress || "255.255.255.255";
    this.resetDelayMs = Number(this.config.resetDelayMs || 3000);
    this.macAddress = normalizeMacAddress(this.config.macAddress);

    this.api.on("didFinishLaunching", () => {
      this.log.info(`Finished launching ${PLATFORM_NAME}`);
      this.discoverDevices();
    });
  }

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }

  discoverDevices() {
    if (!this.host && !this.macAddress) {
      this.log.error(
        'Wake-on-LAN accessory is not configured. Set "macAddress", "host", or both in Homebridge config.',
      );
      return;
    }

    const identity = this.macAddress || this.host;
    const uuid = this.api.hap.uuid.generate(`wol:${identity}`);
    let accessory = this.accessories.find((cachedAccessory) => cachedAccessory.UUID === uuid);

    if (accessory) {
      this.log.info(`Restoring cached accessory for ${this.name}`);
    } else {
      this.log.info(`Adding accessory for ${this.name}`);
      accessory = new this.api.platformAccessory(this.name, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    accessory.context.device = {
      host: this.host,
      macAddress: this.macAddress,
      name: this.name,
    };

    const { Service, Characteristic } = this.api.hap;

    accessory.getService(Service.AccessoryInformation)
      || accessory.addService(Service.AccessoryInformation);

    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, ACCESSORY_INFORMATION.manufacturer)
      .setCharacteristic(Characteristic.Model, ACCESSORY_INFORMATION.model)
      .setCharacteristic(Characteristic.SerialNumber, this.macAddress || this.host || ACCESSORY_INFORMATION.serialNumber);

    let switchService = accessory.getService(Service.Switch);
    if (!switchService) {
      switchService = accessory.addService(Service.Switch, this.name, "wake-switch");
    }

    switchService.setCharacteristic(Characteristic.Name, this.name);
    switchService.getCharacteristic(Characteristic.On)
      .onSet(async (value) => this.handleSetOn(value, switchService, Characteristic));
  }

  async handleSetOn(value, switchService, Characteristic) {
    if (!value) {
      return;
    }

    try {
      const macAddress = await this.resolveMacAddress();
      await sendWakePacket({
        macAddress,
        port: this.port,
        broadcastAddress: this.broadcastAddress,
      });

      const targetLabel = this.host || "configured target";
      this.log.info(`Sent Wake-on-LAN packet to ${targetLabel} (${macAddress})`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log.error(`Failed to send Wake-on-LAN packet: ${reason}`);
      throw error;
    } finally {
      setTimeout(() => {
        switchService.updateCharacteristic(Characteristic.On, false);
      }, this.resetDelayMs);
    }
  }

  async resolveMacAddress() {
    if (this.macAddress) {
      return this.macAddress;
    }

    const ipAddress = await resolveHostToIp(this.host);
    const discoveredMac = await discoverMacAddress(ipAddress);

    if (!discoveredMac) {
      throw new Error(
        `Could not determine a MAC address for ${this.host}. ` +
        `Set "macAddress" in your Homebridge config or provide a reachable host.`,
      );
    }

    return discoveredMac;
  }
}

async function resolveHostToIp(host) {
  const result = await dns.lookup(host);
  return result.address;
}

async function discoverMacAddress(ipAddress) {
  const lookupCommands = [
    { command: "ip", args: ["neigh", "show", ipAddress] },
    { command: "arp", args: ["-n", ipAddress] },
  ];

  for (const lookupCommand of lookupCommands) {
    try {
      const { stdout } = await execFileAsync(lookupCommand.command, lookupCommand.args);
      const macAddress = parseMacAddress(stdout);
      if (macAddress) {
        return macAddress;
      }
    } catch (error) {
      if (error && error.code === "ENOENT") {
        continue;
      }
    }
  }

  return null;
}

function parseMacAddress(text) {
  const match = text.match(/(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/);
  return match ? normalizeMacAddress(match[0]) : null;
}

function normalizeMacAddress(macAddress) {
  if (!macAddress) {
    return null;
  }

  const cleaned = macAddress.trim().replace(/-/g, ":").toLowerCase();
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(cleaned)) {
    throw new Error(`Invalid MAC address: ${macAddress}`);
  }

  return cleaned;
}

async function sendWakePacket({ macAddress, port, broadcastAddress }) {
  const socket = dgram.createSocket("udp4");
  const packet = createMagicPacket(macAddress);

  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 0, packet.length, port, broadcastAddress, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }).finally(() => {
    socket.close();
  });
}

function createMagicPacket(macAddress) {
  const macBytes = Buffer.from(macAddress.replace(/:/g, ""), "hex");
  const packet = Buffer.alloc(6 + (16 * macBytes.length), 0xff);

  for (let offset = 6; offset < packet.length; offset += macBytes.length) {
    macBytes.copy(packet, offset);
  }

  return packet;
}
