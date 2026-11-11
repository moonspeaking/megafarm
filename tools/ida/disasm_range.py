import sys, idapro
idapro.enable_console_messages(False)
idapro.open_database(sys.argv[1], True)
import idc, ida_bytes, struct
a, b = int(sys.argv[2],16), int(sys.argv[3],16)
ea = a
while ea < b:
    print(hex(ea), idc.generate_disasm_line(ea, 0))
    ea = idc.next_head(ea, b+1)
idapro.close_database(False)
