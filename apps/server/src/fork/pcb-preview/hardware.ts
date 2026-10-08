import type { PcbHardware } from "@t3tools/contracts/fork";
/** Manufacturer links are catalog references, not claims about the user's inventory or redistribution licenses. */
export const starterHardware: readonly PcbHardware[] = [
  {
    id: "raspberry-pi-pico",
    name: "Raspberry Pi Pico",
    manufacturer: "Raspberry Pi",
    category: "Microcontroller",
    description:
      "RP2040 development board. Useful for USB devices, sensors and small control projects. GPIO uses 3.3 V logic.",
    documentationUrl: "https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html",
    sourceUrl: "https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html",
    purchaseUrl: "https://www.raspberrypi.com/products/raspberry-pi-pico/",
    width: 21,
    height: 51,
  },
  {
    id: "arduino-uno-r3",
    name: "Arduino Uno Rev3",
    manufacturer: "Arduino",
    category: "Microcontroller",
    description:
      "ATmega328P board with USB, analog inputs and 5 V logic. A useful reference for basic sensor and actuator projects.",
    documentationUrl: "https://docs.arduino.cc/hardware/uno-rev3/",
    sourceUrl: "https://docs.arduino.cc/hardware/uno-rev3/",
    purchaseUrl: "https://store.arduino.cc/products/arduino-uno-rev3",
    width: 53.4,
    height: 68.6,
  },
  {
    id: "esp32-devkitc",
    name: "ESP32-DevKitC",
    manufacturer: "Espressif",
    category: "Wireless controller",
    description:
      "Wi-Fi and Bluetooth development board family. Match the exact module and board revision before relying on a pinout or enclosure dimensions. GPIO uses 3.3 V logic.",
    documentationUrl:
      "https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html",
    sourceUrl:
      "https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html",
    purchaseUrl: "",
    width: null,
    height: null,
  },
  {
    id: "adafruit-feather",
    name: "Adafruit Feather ecosystem",
    manufacturer: "Adafruit",
    category: "Development board",
    description:
      "A family of compact boards and add-on modules. Select a specific Feather model for processor, power, pinout and mechanical details.",
    documentationUrl: "https://learn.adafruit.com/adafruit-feather/overview",
    sourceUrl: "https://learn.adafruit.com/adafruit-feather/overview",
    purchaseUrl: "https://www.adafruit.com/category/943",
    width: null,
    height: null,
  },
].map((item) => ({
  ...item,
  owned: false,
  quantity: 0,
  tags: [],
  license: "Manufacturer assets have their own licenses; check before reuse.",
  notes: "",
  mountingHoles: [],
  assets: [],
}));
