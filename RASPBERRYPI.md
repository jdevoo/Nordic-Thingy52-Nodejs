# Nordic Thingy:52 Node.js library on Raspberry Pi

A step-by-step guide to running the library on a Raspberry Pi.

## Prerequisites

1. A **Raspberry Pi 3B or later** (built-in Bluetooth) or any Raspberry Pi with an external **Bluetooth 4.0+ USB dongle**.
2. [Raspberry Pi OS **Bookworm**](https://www.raspberrypi.com/software/) (64-bit recommended). Earlier images ship with EOL versions of system packages and are not supported.

## Setup

### 1. Flash and boot Raspberry Pi OS

[Install Raspberry Pi OS Bookworm](https://www.raspberrypi.com/documentation/computers/getting-started.html) onto an SD card using [Raspberry Pi Imager](https://www.raspberrypi.com/software/).

To enable SSH before first boot, enable it in Raspberry Pi Imager's advanced options, or create an empty file called `ssh` in the boot partition.

### 2. Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify: `node --version` should print `v20.x.x` or later.

### 3. Install system dependencies

These packages are required to compile the native BLE addon and to talk to the Bluetooth stack:

```bash
sudo apt-get install -y bluetooth bluez libbluetooth-dev libudev-dev python3 make g++
```

### 4. Install the library

```bash
git clone https://github.com/NordicPlayground/Nordic-Thingy52-Nodejs.git
cd Nordic-Thingy52-Nodejs
npm install
```

### 5. Grant BLE capabilities (no root required)

Rather than running every script with `sudo`, grant the Node.js binary the two capabilities it needs for raw Bluetooth sockets:

```bash
sudo setcap cap_net_raw,cap_net_admin+eip $(which node)
```

> **Note:** this capability is tied to the Node.js binary. Re-run the command whenever you upgrade Node.js to a new version.

### 6. Run an example

```bash
node examples/environment.js
```

To target a specific device by Bluetooth address:

```bash
node examples/environment.js -a xx:xx:xx:xx:xx:xx
```

Some examples need additional npm packages that are not listed in the main `package.json`:

| Example         | Additional package     |
| --------------- | ---------------------- |
| `microphone.js` | `npm install speaker`  |
| `firebase.js`   | `npm install firebase` |
| `imes.js`       | `npm install firebase` |

For `microphone.js` with a loopback audio device, first add the loopback module and copy the ALSA configuration:

```bash
sudo modprobe snd-aloop
# Add snd-bcm2835 and snd-aloop to /etc/modules to persist across reboots
sudo cp examples/rpi/asound.conf /etc/asound.conf
node examples/microphone.js -d loopin
```

## Running as a systemd Service

To run your Thingy:52 application automatically at boot as a background service:

1. Create a unit file at `/etc/systemd/system/thingy.service`:

```ini
[Unit]
Description=Nordic Thingy:52 Node.js Application
After=bluetooth.target network.target
Wants=bluetooth.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/Nordic-Thingy52-Nodejs
ExecStart=/usr/bin/node examples/environment.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

> **Note:** Update `User`, `WorkingDirectory`, and the path to `node` (`which node`) to match your environment. If running as a non-root user, ensure you have granted BLE capabilities (`setcap`) to the Node.js binary as described in step 5.

2. Reload `systemd`, enable, and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable thingy.service
sudo systemctl start thingy.service
```

3. Check status and logs:

```bash
sudo systemctl status thingy.service
journalctl -u thingy.service -f
```

## Troubleshooting & Tips

### Rebuilding native modules

If you upgrade Node.js or encounter `Error: Cannot find module '../build/Release/bluetooth_hci_socket.node'`, recompile the native C++ addon for your current Node version:

```bash
npm rebuild
```

### Re-granting BLE capabilities

Whenever Node.js is updated (via `apt` or `nvm`), the capabilities set by `setcap` on the binary are cleared. Re-run:

```bash
sudo setcap cap_net_raw,cap_net_admin+eip $(which node)
```

### BLE discovery hangs or does not find the Thingy:52

When running an example (e.g. `node examples/environment.js`), the script scans for BLE advertisements matching the Thingy service UUID. If it stays waiting on the initial console lines:

1. **Check Thingy status:** Ensure the Thingy:52 is powered on and advertising (the LED should be breathing/fading). If it is connected to another device (such as a smartphone app) or went to sleep, power-cycle it or press the main top button.
2. **Reset Bluetooth adapter / `bluetoothd` conflicts:** The system Bluetooth daemon (`bluetoothd`) can sometimes conflict with raw HCI sockets used by `@abandonware/noble`. You can reset the interface or temporarily stop `bluetoothd`:
   ```bash
   sudo hciconfig hci0 reset
   # Or stop bluetoothd if conflicts persist
   sudo systemctl stop bluetooth
   ```
3. **Target by MAC address:** If you know your device's address, target it directly:
   ```bash
   node examples/environment.js -a xx:xx:xx:xx:xx:xx
   ```
