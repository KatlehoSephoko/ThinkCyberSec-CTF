from scapy.all import *

background = [
    Ether()/IP(dst="8.8.8.8", src="192.168.1.15")/ICMP(),
    Ether()/ARP(op=1, pdst="192.168.1.1", psrc="192.168.1.50")
]
malicious = Ether(dst="ff:ff:ff:ff:ff:ff", src="00:0c:29:ab:cd:ef") / ARP(op=2, pdst="192.168.1.100", psrc="192.168.1.1", hwsrc="00:0c:29:ab:cd:ef") / Raw(load="tcs{poison_detected}")
wrpcap("arp_trace.pcap", background[:1] + [malicious] + background[1:])
