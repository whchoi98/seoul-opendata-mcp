"""Seoul OpenData MCP architecture infographic (16:9, dark and light). Text lives in arch_ko.T and arch_en.T.

Build: put infokit.py and buildkit.py from the aws-infographic skill next to these files, then run
    python3 buildkit.py build arch_ko:architecture-ko arch_en:architecture-en
The PNGs in docs/images/ are the 2x renders reduced to a 256-colour palette (Pillow quantize, no dither).
Needs the NanumSquareOTF and D2Coding fonts, Playwright Chromium and the aws-diagram icon bundle.
"""
from infokit import (Doc, rw, dot_list, cell, tag, callout, header, section, footer_note, check, CODE_FAMILY)

K = 1.12  # type scale: the image is shown at about half width in a README


def node(d, x, y, w, h, title, sub, color, icon=None, code_sub=False, tsize=17, ssize=14):
    """Rounded box with a title, an optional caption and an optional AWS icon. color=None draws a neutral box."""
    box = (x, y, w, h)
    if color:
        d.rect(x, y, w, h, rx=10, fill=color + "F", fo=0.10, stroke=color, sw=1.3)
    else:
        d.rect(x, y, w, h, rx=10, fill="panel", stroke="chipline", sw=1.2)
    tx = x + 14
    if icon:
        isz = h - 18
        d.icon(icon, x + 9, y + 9, isz)
        tx = x + 9 + isz + 11
    if not sub:
        d.text(tx, y + h / 2 + tsize * 0.36, title, tsize, 700, "text", box=box)
        return
    d.text(tx, y + h / 2 - 4, title, tsize, 700, "text", box=box)
    if code_sub:
        d.text(tx, y + h / 2 + 17, sub, ssize - 1, 400, "muted", family=CODE_FAMILY, box=box)
    else:
        d.text(tx, y + h / 2 + 17, sub, ssize, 400, "muted", box=box)


def line_tag(d, cx, mid, text, color, box):
    """Tag sitting on an arrow line: an opaque patch first so the line does not run through the text."""
    w = rw(text, 14, 700) + 24
    d.rect(cx - w / 2 - 6, mid - 15, w + 12, 30, rx=15, fill="card")
    tag(d, cx - w / 2, mid - 13, text, color, 14, 26, 12, box=box)


def s1(d, x, y, w, h, T, theme):
    cy = section(d, x, y, w, h, 1, *T["s1"], tsize=23, ksize=16)
    box = (x, y, w, h)
    lane_h, gap, nh = 64, 10, 54
    cx0, cwid = x + 24, 270                                  # caller column
    ax, bx, cxx, nw = x + 422, x + 782, x + 1142, 310        # slots A, B, C
    sx, swid = x + 1508, 292                                 # server box
    # The bundle names the sets after the glyph tone: light glyphs go on the dark theme and the reverse.
    aset = "agentcore-light" if theme == "dark" else "agentcore-dark"
    for i, ln in enumerate(T["lanes"]):
        ly = cy + i * (lane_h + gap)
        ny, mid = ly + (lane_h - nh) / 2, ly + lane_h / 2
        node(d, cx0, ny, cwid, nh, ln["caller"][0], ln["caller"][1], None)
        cend = cx0 + cwid
        if i < 2:
            d.arrow([(cend + 4, mid), (cxx - 5, mid)])
            d.text(cend + 20, mid - 10, ln["link"], 15, 400, "muted", box=box)
            line_tag(d, (cend + cxx) / 2 + 70, mid, ln["tag"], ln["color"], box)
            icon = f"{aset}/Runtime" if i == 1 else None
            node(d, cxx, ny, nw, nh, ln["run"][0], ln["run"][1], ln["color"], icon=icon, code_sub=(i == 0))
        else:
            gx, gw = ax - 10, (bx + nw + 10) - (ax - 10)
            d.rect(gx, ly, gw, lane_h, rx=14, fill="none", stroke="purple", sw=1.2, dash="7 5")
            d.arrow([(cend + 4, mid), (gx - 5, mid)])
            d.text((cend + gx) / 2, mid - 10, ln["link"], 15, 400, "muted", "middle", box=box)
            node(d, ax, ny, nw, nh, ln["gw"][0], ln["gw"][1], "purple", icon=f"{aset}/Gateway")
            d.arrow([(ax + nw + 5, mid), (bx - 5, mid)], color="purple")
            d.arrow([(bx - 5, mid), (ax + nw + 5, mid)], color="purple")
            node(d, bx, ny, nw, nh, ln["fn"][0], ln["fn"][1], "purple", icon="service/AWS-Lambda")
            d.arrow([(gx + gw + 3, mid), (cxx - 5, mid)])
            node(d, cxx, ny, nw, nh, ln["run"][0], ln["run"][1], "blue", icon=f"{aset}/Runtime")
        d.arrow([(cxx + nw + 4, mid), (sx - 5, mid)])
    sh = 3 * lane_h + 2 * gap
    sbox = (sx, cy, swid, sh)
    d.rect(sx, cy, swid, sh, rx=14, fill="orangeF", fo=0.10, stroke="orange", sw=1.6)
    mx = sx + swid / 2
    title, big, cap1, cap2 = T["server"]
    d.text(mx, cy + 40, title, 20, 700, "text", "middle", box=sbox)
    d.text(mx, cy + 64, "seoul-opendata-mcp", 14, 400, "muted", "middle", family=CODE_FAMILY, box=sbox)
    d.text(mx, cy + 124, big, 42, 700, "orange", "middle", box=sbox)
    d.text(mx, cy + 162, cap1, 15, 400, "text2", "middle", box=sbox)
    d.text(mx, cy + 186, cap2, 15, 400, "text2", "middle", box=sbox)


def s2(d, x, y, w, h, T):
    cy = section(d, x, y, w, h, 2, *T["s2"], tsize=23, ksize=16)
    box = (x, y, w, h)
    steps = T["steps"]
    n, gap = len(steps), 34
    ix, iw = x + 24, w - 48
    bw = (iw - gap * (n - 1)) / n
    by, bh = cy + 6, 62

    def col(i):
        return ix + i * (bw + gap)

    for i, (title, sub, color, code) in enumerate(steps):
        node(d, col(i), by, bw, bh, title, sub, color, code_sub=code)
        if i < n - 1:
            d.arrow([(col(i) + bw + 5, by + bh / 2), (col(i) + bw + gap - 5, by + bh / 2)])
    # Second lane: the snapshot store and its collection path. It runs right to left so that the store sits
    # under the client that reads it and the collector under the API it calls.
    st = T["store"]
    ly, lh = by + bh + 48, 58 * K
    mid = ly + lh / 2
    sw = 2 * bw + gap
    sbox = (col(0), ly, sw, lh)
    node(d, *sbox, st["s3"][0], st["s3"][1], "yellow", icon="service/Amazon-Simple-Storage-Service")
    tx = col(0) + sw - 14
    for t in reversed(st["tags"]):
        tx -= rw(t, 13, 700) + 24
        tag(d, tx, mid - 13, t, "yellow", 13, 26, 12, box=sbox)
        tx -= 8
    node(d, col(2), ly, bw, lh, st["fn"][0], st["fn"][1], None, icon="service/AWS-Lambda")
    schw = bw + 32
    node(d, col(3), ly, schw, lh, st["sched"][0], st["sched"][1], None, icon="service/Amazon-EventBridge")
    d.arrow([(col(3) - 5, mid), (col(2) + bw + 5, mid)])
    d.arrow([(col(2) - 5, mid), (col(0) + sw + 5, mid)])
    lab_y = by + bh + 29
    cx = col(1) + bw / 2
    d.arrow([(cx, by + bh + 5), (cx, ly - 5)])
    d.text(cx + 14, lab_y, st["read"], 14, 400, "muted", box=box)
    cx = col(2) + bw / 2
    d.arrow([(cx, ly - 5), (cx, by + bh + 5)])
    d.text(cx + 14, lab_y, st["call"], 14, 400, "muted", box=box)
    ox = col(3) + schw + gap
    callout(d, ox, ly, ix + iw - ox, *T["insight"], k=K, box=box)


def s3(d, x, y, w, h, T):
    cy = section(d, x, y, w, h, 3, *T["s3"], tsize=23, ksize=16)
    ix, iw, gap = x + 24, w - 48, 16
    cwid = (iw - 2 * gap) / 3
    cy0 = cy + 4
    ch = y + h - 20 - cy0
    for i, (name, color, side, bullets) in enumerate(T["cards"]):
        cx = ix + i * (cwid + gap)
        cbox = (cx, cy0, cwid, ch)
        d.rect(cx, cy0, cwid, ch, rx=12, fill="panel", stroke=color, sw=1.3)
        tag(d, cx + 16, cy0 + 14, name, color, 15, 28, 12, box=cbox)
        d.text(cx + cwid - 16, cy0 + 33, side, 13, 400, "muted", "end", box=cbox)
        dot_list(d, cx + 16, cy0 + 78, cwid - 32, bullets, 16, 23, 11, dot=color, box=cbox)


def s4(d, x, y, w, h, T):
    cy = section(d, x, y, w, h, 4, *T["s4"], tsize=23, ksize=16)
    box = (x, y, w, h)
    ix, iw = x + 24, w - 48
    d.text(ix, cy + 14, T["head"][0], 13, 700, "faint", box=box)
    d.text(ix + iw, cy + 14, T["head"][1], 13, 700, "faint", "end", box=box)
    ry, rh = cy + 26, 42
    for i, (name, desc, fail) in enumerate(T["rows"]):
        top, mid = ry + i * rh, ry + i * rh + rh / 2
        d.line(ix, top, ix + iw, top, stroke="cardline", sw=1)
        d.circle(ix + 12, mid, 11, fill="purpleF", fo=0.18, stroke="purple", sw=1.1)
        d.text(ix + 12, mid + 4.8, str(i + 1), 13, 700, "text", "middle")
        d.text(ix + 34, mid + 5.5, name, 16, 700, "text", box=box)
        cell(d, ix + 150, mid, iw - 150 - 164, desc, 15, 20, 400, "text2", box)
        fwid = rw(fail, 14, 700) + 24
        tag(d, ix + iw - fwid, mid - 13, fail, "pink", 14, 26, 12, box=box)
    end = ry + len(T["rows"]) * rh
    d.line(ix, end, ix + iw, end, stroke="cardline", sw=1)
    half = (iw - 24) / 2
    mid = end + 14 + 22
    check(d, ix + 3, mid - 7, 14)
    cell(d, ix + 28, mid, half - 28, T["pass"], 15, 20, 400, "text2", box)
    dx = ix + half + 24
    d.icon("service/Amazon-DynamoDB", dx, mid - 20, 40)
    d.text(dx + 52, mid - 3, T["ddb"][0], 16, 700, "text", box=box)
    d.text(dx + 52, mid + 17, T["ddb"][1], 14, 400, "muted", box=box)


def render(T, theme):
    d = Doc(1920, 1080, theme)
    d.rect(0, 0, 1920, 1080, fill="bg")
    header(d, 48, 76, T["title"], T["sub_en"], T["sub_ko"])
    s1(d, 48, 140, 1824, 298, T, theme)
    s2(d, 48, 456, 1824, 268, T)
    s3(d, 48, 742, 1100, 302, T)
    s4(d, 1168, 742, 704, 302, T)
    footer_note(d, 1872, 1064, T["note"])
    return d.svg()
