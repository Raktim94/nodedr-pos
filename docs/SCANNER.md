# Barcode scanner troubleshooting

POS Checkout supports USB and Bluetooth scanners that work as a **keyboard** (HID keyboard / "keyboard wedge" mode). Click nowhere first — just scan.

## 1. Check the scanner is in HID keyboard mode

Many scanners also have a serial/COM, "HID POS" or "SPP" mode, which a browser cannot read as typing. Scan the **USB HID Keyboard** (or Bluetooth **HID**) setup code from the scanner's manual, then pair/replug.

## 2. Test what the scanner actually sends

Open any plain text editor (Notepad, gedit, TextEdit in plain-text mode), click into it, and scan a barcode.

- The digits should appear, followed by a **new line** (Enter suffix) or a **jump to the next position / tab** (Tab suffix).
- Nothing appears: wrong mode, not paired, or the label is damaged. Try another barcode.
- Wrong or extra characters (prefix, `*`, letters): the scanner has a prefix/keyboard-layout setting. Reset it to defaults or select your keyboard layout.
- Everything appears on one line with no break: no suffix is configured. Enable **Enter** (CR) or **Tab** suffix in the scanner's setup, because the POS needs a suffix to know the scan ended.

## 3. Suffix configuration

Enter (CR/CRLF) and Tab are both accepted; a second suffix (e.g. Enter+Tab) is ignored safely. Keep the scanner's inter-character delay at its default (or ≤ ~40 ms average). Typing the code by hand is not treated as a scan; use the manual search box under the cart for that.

## 4. If the code scans but nothing is added

A toast says `No product matches "<code>"`. Check the Inventory product's barcode or SKU matches exactly what the text editor showed (including leading zeros).

## Still not working?

Report the scanner model, connection type (USB/Bluetooth), what the text-editor test showed, and the suffix setting.
