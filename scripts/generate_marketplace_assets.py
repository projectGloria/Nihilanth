"""
Generate high-fidelity UI visual assets for Nihilanth Marketplace & README.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import shutil

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / 'media'
MEDIA.mkdir(exist_ok=True)

# 1. Copy & optimize hero banner
HERO_SRC = Path(r'C:\Users\Nihil\.gemini\antigravity\brain\5061178d-44f7-4ade-9624-63f9a0dc4aed\nihilanth_toolbox_hero_banner_with_title_1793008975527.jpg')
if HERO_SRC.exists():
    hero_img = Image.open(HERO_SRC)
    # Save as high quality PNG
    hero_img.save(MEDIA / 'hero-banner.png', 'PNG', optimize=True)
    print("Saved media/hero-banner.png")

# Dragon icon geometry from build-icons.py
DRAGON_OUTLINE = [(3, 1), (9, 5), (15, 2), (14, 7), (18, 9), (19, 11),
                  (23, 12), (22, 16), (17, 16), (20, 18), (17, 21),
                  (9, 23), (11, 19), (6, 17), (3, 13), (7, 14),
                  (5, 10), (1, 7), (7, 8)]
DRAGON_EYE = [(12, 10), (16, 12), (12, 12)]

def draw_dragon(draw, x, y, size, fill="#2dd4bf"):
    scale = size / 24.0
    outline_pts = [(x + px * scale, y + py * scale) for px, py in DRAGON_OUTLINE]
    eye_pts = [(x + px * scale, y + py * scale) for px, py in DRAGON_EYE]
    draw.polygon(outline_pts, fill=fill)
    draw.polygon(eye_pts, fill="#181825") # cutout eye

# Font loaders
def get_font(name, size):
    paths = {
        'code': r'C:\Windows\Fonts\cascadiacode.ttf',
        'code_bold': r'C:\Windows\Fonts\consolab.ttf',
        'ui': r'C:\Windows\Fonts\segoeui.ttf',
        'ui_bold': r'C:\Windows\Fonts\segoeuib.ttf',
    }
    font_path = paths.get(name, paths['ui'])
    try:
        return ImageFont.truetype(font_path, size)
    except Exception:
        return ImageFont.load_default()

# -------------------------------------------------------------
# ASSET 1: Feature - TypeScript Mock Data & Slash Commands
# -------------------------------------------------------------
def create_feature_data_generation():
    scale = 2
    w, h = 960 * scale, 560 * scale
    img = Image.new('RGBA', (w, h), (15, 23, 42, 255))
    draw = ImageDraw.Draw(img)

    # Window Container Card
    pad = 20 * scale
    win_w = w - pad * 2
    win_h = h - pad * 2
    win_rect = (pad, pad, pad + win_w, pad + win_h)
    
    # Outer subtle glow & shadow
    draw.rounded_rectangle(win_rect, radius=14 * scale, fill=(24, 24, 37, 255), outline=(51, 65, 85, 255), width=2 * scale)

    # Window Title Bar
    title_h = 44 * scale
    draw.rounded_rectangle((pad, pad, pad + win_w, pad + title_h), radius=14 * scale, fill=(30, 30, 46, 255))
    draw.rectangle((pad, pad + title_h - 10 * scale, pad + win_w, pad + title_h), fill=(30, 30, 46, 255))
    draw.line((pad, pad + title_h, pad + win_w, pad + title_h), fill=(51, 65, 85, 255), width=1 * scale)

    # Window dots
    for i, c in enumerate([(239, 68, 68), (245, 158, 11), (16, 185, 129)]):
        draw.ellipse((pad + (20 + i * 22) * scale, pad + 16 * scale, pad + (32 + i * 22) * scale, pad + 28 * scale), fill=c)

    # Active Tab
    tab_x = pad + 100 * scale
    tab_w = 230 * scale
    draw.rounded_rectangle((tab_x, pad + 8 * scale, tab_x + tab_w, pad + title_h), radius=6 * scale, fill=(24, 24, 37, 255), outline=(51, 65, 85, 255), width=1 * scale)
    draw.line((tab_x + 1, pad + title_h, tab_x + tab_w - 1, pad + title_h), fill=(24, 24, 37, 255), width=2 * scale)
    draw.text((tab_x + 28 * scale, pad + 14 * scale), "userService.test.ts", font=get_font('ui', 13 * scale), fill=(226, 232, 240, 255))
    draw.text((tab_x + 10 * scale, pad + 14 * scale), "TS", font=get_font('code_bold', 12 * scale), fill=(49, 120, 198, 255))

    # Editor Gutter & Code Lines
    gutter_w = 48 * scale
    editor_y = pad + title_h + 16 * scale
    
    code_lines = [
        ("1", [("type ", "#ff7b72"), ("UserProfile ", "#ffa657"), ("= {", "#e2e8f0")]),
        ("2", [("  id", "#9cdcfe"), (": ", "#e2e8f0"), ("string", "#4ec9b0"), (";", "#e2e8f0")]),
        ("3", [("  name", "#9cdcfe"), (": ", "#e2e8f0"), ("string", "#4ec9b0"), (";", "#e2e8f0")]),
        ("4", [("  email", "#9cdcfe"), (": ", "#e2e8f0"), ("string", "#4ec9b0"), (";", "#e2e8f0")]),
        ("5", [("  role", "#9cdcfe"), (": ", "#e2e8f0"), ("'admin' | 'editor' | 'guest'", "#ce9178"), (";", "#e2e8f0")]),
        ("6", [("  isActive", "#9cdcfe"), (": ", "#e2e8f0"), ("boolean", "#4ec9b0"), (";", "#e2e8f0")]),
        ("7", [("};", "#e2e8f0")]),
        ("8", []),
        ("9", [("// Type slash command to generate deterministic mock data at cursor", "#6a737d")]),
        ("10", [("/data from UserProfile 3 --format=json --seed=42", "#2dd4bf")]),
    ]

    for idx, (num, tokens) in enumerate(code_lines):
        line_y = editor_y + idx * 26 * scale
        # Line number
        draw.text((pad + 18 * scale, line_y), num.rjust(2), font=get_font('code', 13 * scale), fill=(100, 116, 139, 255))
        # Tokens
        cur_x = pad + gutter_w + 16 * scale
        for text, color in tokens:
            draw.text((cur_x, line_y), text, font=get_font('code', 14 * scale), fill=color)
            w_text = draw.textlength(text, font=get_font('code', 14 * scale))
            cur_x += w_text

    # Cursor
    cursor_x = cur_x + 2 * scale
    cursor_y = editor_y + 9 * 26 * scale
    draw.line((cursor_x, cursor_y, cursor_x, cursor_y + 18 * scale), fill="#2dd4bf", width=2 * scale)

    # Autocomplete Popup
    pop_x = pad + gutter_w + 16 * scale
    pop_y = cursor_y + 24 * scale
    pop_w = 410 * scale
    pop_h = 160 * scale

    # Popup box
    draw.rounded_rectangle((pop_x, pop_y, pop_x + pop_w, pop_y + pop_h), radius=8 * scale, fill=(30, 30, 46, 255), outline=(45, 212, 191, 200), width=1 * scale)

    # Active suggestion item
    draw.rectangle((pop_x + 1, pop_y + 1, pop_x + pop_w - 1, pop_y + 38 * scale), fill=(45, 75, 110, 255))
    draw_dragon(draw, pop_x + 10 * scale, pop_y + 10 * scale, 18 * scale, fill="#2dd4bf")
    draw.text((pop_x + 36 * scale, pop_y + 9 * scale), "/data from UserProfile", font=get_font('code_bold', 13 * scale), fill="#ffffff")
    draw.text((pop_x + 245 * scale, pop_y + 10 * scale), "Generate 3 records", font=get_font('ui', 11 * scale), fill="#94a3b8")

    # Item 2
    item2_y = pop_y + 38 * scale
    draw_dragon(draw, pop_x + 10 * scale, item2_y + 10 * scale, 18 * scale, fill="#0d9488")
    draw.text((pop_x + 36 * scale, item2_y + 9 * scale), "/data from UserProfile 1", font=get_font('code', 13 * scale), fill="#cbd5e1")
    draw.text((pop_x + 265 * scale, item2_y + 10 * scale), "Single object", font=get_font('ui', 11 * scale), fill="#64748b")

    # Item 3
    item3_y = pop_y + 76 * scale
    draw_dragon(draw, pop_x + 10 * scale, item3_y + 10 * scale, 18 * scale, fill="#0d9488")
    draw.text((pop_x + 36 * scale, item3_y + 9 * scale), "/data users 5", font=get_font('code', 13 * scale), fill="#cbd5e1")
    draw.text((pop_x + 270 * scale, item3_y + 10 * scale), "Built-in preset", font=get_font('ui', 11 * scale), fill="#64748b")

    # Item 4
    item4_y = pop_y + 114 * scale
    draw_dragon(draw, pop_x + 10 * scale, item4_y + 10 * scale, 18 * scale, fill="#0d9488")
    draw.text((pop_x + 36 * scale, item4_y + 9 * scale), "/data products 5", font=get_font('code', 13 * scale), fill="#cbd5e1")
    draw.text((pop_x + 270 * scale, item4_y + 10 * scale), "Built-in preset", font=get_font('ui', 11 * scale), fill="#64748b")

    # Documentation / Preview Flyout on the right
    doc_x = pop_x + pop_w + 12 * scale
    doc_y = pop_y
    doc_w = 400 * scale
    doc_h = pop_h + 20 * scale

    draw.rounded_rectangle((doc_x, doc_y, doc_x + doc_w, doc_y + doc_h), radius=8 * scale, fill=(24, 24, 37, 255), outline=(51, 65, 85, 255), width=1 * scale)
    
    # Doc Header
    draw.rectangle((doc_x, doc_y, doc_x + doc_w, doc_y + 30 * scale), fill=(30, 30, 46, 255))
    draw.text((doc_x + 14 * scale, doc_y + 6 * scale), "Nihilanth Instant Mock Preview", font=get_font('ui_bold', 12 * scale), fill="#2dd4bf")

    # Mock JSON lines in Preview
    json_lines = [
        '[',
        '  {',
        '    "id": "usr_94a7e2b1",',
        '    "name": "Sarah Connor",',
        '    "email": "sarah.connor@example.com",',
        '    "role": "admin",',
        '    "isActive": true',
        '  }, ...',
        ']'
    ]
    for j_idx, j_line in enumerate(json_lines):
        color = "#e2e8f0"
        if '"id"' in j_line or '"name"' in j_line or '"email"' in j_line or '"role"' in j_line or '"isActive"' in j_line:
            color = "#7dd3fc"
        elif "admin" in j_line or "Sarah" in j_line or "example" in j_line or "usr_" in j_line:
            color = "#86efac"
        elif "true" in j_line:
            color = "#f472b6"
        draw.text((doc_x + 14 * scale, doc_y + (36 + j_idx * 16) * scale), j_line, font=get_font('code', 11 * scale), fill=color)

    # Bottom Pill callout
    pill_w = 340 * scale
    pill_h = 32 * scale
    pill_x = w - pad - pill_w - 16 * scale
    pill_y = h - pad - pill_h - 14 * scale
    draw.rounded_rectangle((pill_x, pill_y, pill_x + pill_w, pill_y + pill_h), radius=16 * scale, fill=(19, 78, 74, 255), outline=(45, 212, 191, 255), width=1 * scale)
    draw_dragon(draw, pill_x + 10 * scale, pill_y + 7 * scale, 18 * scale, fill="#2dd4bf")
    draw.text((pill_x + 36 * scale, pill_y + 7 * scale), "Deterministic & Type-Safe Mock Generation", font=get_font('ui_bold', 12 * scale), fill="#ffffff")

    # Downsample lanczos for ultra-crisp antialiasing
    final_img = img.resize((960, 560), Image.Resampling.LANCZOS)
    final_img.save(MEDIA / 'feature-data-generation.png', 'PNG', optimize=True)
    print("Saved media/feature-data-generation.png")


# -------------------------------------------------------------
# ASSET 2: Feature - Automatic Code Memory & Instant Recall
# -------------------------------------------------------------
def create_feature_code_memory():
    scale = 2
    w, h = 960 * scale, 560 * scale
    img = Image.new('RGBA', (w, h), (15, 23, 42, 255))
    draw = ImageDraw.Draw(img)

    pad = 20 * scale
    win_w = w - pad * 2
    win_h = h - pad * 2
    win_rect = (pad, pad, pad + win_w, pad + win_h)

    draw.rounded_rectangle(win_rect, radius=14 * scale, fill=(24, 24, 37, 255), outline=(51, 65, 85, 255), width=2 * scale)

    # Title Bar
    title_h = 44 * scale
    draw.rounded_rectangle((pad, pad, pad + win_w, pad + title_h), radius=14 * scale, fill=(30, 30, 46, 255))
    draw.rectangle((pad, pad + title_h - 10 * scale, pad + win_w, pad + title_h), fill=(30, 30, 46, 255))
    draw.line((pad, pad + title_h, pad + win_w, pad + title_h), fill=(51, 65, 85, 255), width=1 * scale)

    # Window dots
    for i, c in enumerate([(239, 68, 68), (245, 158, 11), (16, 185, 129)]):
        draw.ellipse((pad + (20 + i * 22) * scale, pad + 16 * scale, pad + (32 + i * 22) * scale, pad + 28 * scale), fill=c)

    # Active Tab
    tab_x = pad + 100 * scale
    tab_w = 230 * scale
    draw.rounded_rectangle((tab_x, pad + 8 * scale, tab_x + tab_w, pad + title_h), radius=6 * scale, fill=(24, 24, 37, 255), outline=(51, 65, 85, 255), width=1 * scale)
    draw.line((tab_x + 1, pad + title_h, tab_x + tab_w - 1, pad + title_h), fill=(24, 24, 37, 255), width=2 * scale)
    draw.text((tab_x + 28 * scale, pad + 14 * scale), "authMiddleware.ts", font=get_font('ui', 13 * scale), fill=(226, 232, 240, 255))
    draw.text((tab_x + 10 * scale, pad + 14 * scale), "TS", font=get_font('code_bold', 12 * scale), fill=(49, 120, 198, 255))

    gutter_w = 48 * scale
    editor_y = pad + title_h + 16 * scale

    code_lines = [
        ("1", [("import ", "#ff7b72"), ("{ verifyToken } ", "#e2e8f0"), ("from ", "#ff7b72"), ("'./jwt'", "#ce9178"), (";", "#e2e8f0")]),
        ("2", []),
        ("3", [("// Code deleted 15 minutes ago is automatically recalled as you type", "#6a737d")]),
        ("4", [("export async function ", "#ff7b72"), ("handleRequest", "#61afef"), ("(req, res) {", "#e2e8f0")]),
        ("5", [("  const session = await ", "#e2e8f0"), ("val", "#2dd4bf")]),
    ]

    for idx, (num, tokens) in enumerate(code_lines):
        line_y = editor_y + idx * 28 * scale
        draw.text((pad + 18 * scale, line_y), num.rjust(2), font=get_font('code', 13 * scale), fill=(100, 116, 139, 255))
        cur_x = pad + gutter_w + 16 * scale
        for text, color in tokens:
            draw.text((cur_x, line_y), text, font=get_font('code', 14 * scale), fill=color)
            w_text = draw.textlength(text, font=get_font('code', 14 * scale))
            cur_x += w_text

    cursor_x = cur_x + 2 * scale
    cursor_y = editor_y + 4 * 28 * scale
    draw.line((cursor_x, cursor_y, cursor_x, cursor_y + 18 * scale), fill="#2dd4bf", width=2 * scale)

    # Suggestion box
    pop_x = pad + gutter_w + 16 * scale
    pop_y = cursor_y + 26 * scale
    pop_w = 390 * scale
    pop_h = 175 * scale

    draw.rounded_rectangle((pop_x, pop_y, pop_x + pop_w, pop_y + pop_h), radius=8 * scale, fill=(30, 30, 46, 255), outline=(45, 212, 191, 200), width=1 * scale)

    # Item 1 (Selected)
    draw.rectangle((pop_x + 1, pop_y + 1, pop_x + pop_w - 1, pop_y + 42 * scale), fill=(45, 75, 110, 255))
    draw_dragon(draw, pop_x + 10 * scale, pop_y + 12 * scale, 18 * scale, fill="#2dd4bf")
    draw.text((pop_x + 36 * scale, pop_y + 8 * scale), "validateSessionToken — code", font=get_font('code_bold', 13 * scale), fill="#ffffff")
    draw.text((pop_x + 36 * scale, pop_y + 24 * scale), "Recalled Declaration • deleted 15m ago", font=get_font('ui', 11 * scale), fill="#7dd3fc")

    # Item 2
    item2_y = pop_y + 43 * scale
    draw_dragon(draw, pop_x + 10 * scale, item2_y + 12 * scale, 18 * scale, fill="#0d9488")
    draw.text((pop_x + 36 * scale, item2_y + 8 * scale), "validateSessionToken — name", font=get_font('code', 13 * scale), fill="#e2e8f0")
    draw.text((pop_x + 36 * scale, item2_y + 24 * scale), "Identifier only • src/auth.ts", font=get_font('ui', 11 * scale), fill="#94a3b8")

    # Item 3
    item3_y = pop_y + 86 * scale
    draw_dragon(draw, pop_x + 10 * scale, item3_y + 12 * scale, 18 * scale, fill="#0d9488")
    draw.text((pop_x + 36 * scale, item3_y + 8 * scale), "validateBearerAuth — snippet", font=get_font('code', 13 * scale), fill="#e2e8f0")
    draw.text((pop_x + 36 * scale, item3_y + 24 * scale), "Pinned Global Snippet • #auth", font=get_font('ui', 11 * scale), fill="#a78bfa")

    # Item 4
    item4_y = pop_y + 129 * scale
    draw_dragon(draw, pop_x + 10 * scale, item4_y + 12 * scale, 18 * scale, fill="#0d9488")
    draw.text((pop_x + 36 * scale, item4_y + 8 * scale), "/recall validate", font=get_font('code', 13 * scale), fill="#94a3b8")
    draw.text((pop_x + 36 * scale, item4_y + 24 * scale), "Filter history entries...", font=get_font('ui', 11 * scale), fill="#64748b")

    # Preview Flyout on the right showing recovered function
    doc_x = pop_x + pop_w + 14 * scale
    doc_y = pop_y
    doc_w = 420 * scale
    doc_h = pop_h + 30 * scale

    draw.rounded_rectangle((doc_x, doc_y, doc_x + doc_w, doc_y + doc_h), radius=8 * scale, fill=(24, 24, 37, 255), outline=(51, 65, 85, 255), width=1 * scale)
    
    # Doc Header
    draw.rectangle((doc_x, doc_y, doc_x + doc_w, doc_y + 32 * scale), fill=(30, 30, 46, 255))
    draw.text((doc_x + 14 * scale, doc_y + 8 * scale), "Preserved Implementation Body", font=get_font('ui_bold', 12 * scale), fill="#2dd4bf")

    body_lines = [
        ("async function validateSessionToken(token: string) {", "#e2e8f0"),
        ("  const decoded = await verifyToken(token);", "#e2e8f0"),
        ("  if (!decoded || decoded.exp < Date.now()) {", "#e2e8f0"),
        ("    throw new AuthError('Token expired');", "#f87171"),
        ("  }", "#e2e8f0"),
        ("  return decoded.payload;", "#60a5fa"),
        ("}", "#e2e8f0"),
    ]
    for b_idx, (b_code, b_col) in enumerate(body_lines):
        draw.text((doc_x + 14 * scale, doc_y + (40 + b_idx * 18) * scale), b_code, font=get_font('code', 11 * scale), fill=b_col)

    pill_w = 350 * scale
    pill_h = 32 * scale
    pill_x = w - pad - pill_w - 16 * scale
    pill_y = h - pad - pill_h - 14 * scale
    draw.rounded_rectangle((pill_x, pill_y, pill_x + pill_w, pill_y + pill_h), radius=16 * scale, fill=(19, 78, 74, 255), outline=(45, 212, 191, 255), width=1 * scale)
    draw_dragon(draw, pill_x + 10 * scale, pill_y + 7 * scale, 18 * scale, fill="#2dd4bf")
    draw.text((pill_x + 36 * scale, pill_y + 7 * scale), "Passive Zero-Config Workspace Memory", font=get_font('ui_bold', 12 * scale), fill="#ffffff")

    final_img = img.resize((960, 560), Image.Resampling.LANCZOS)
    final_img.save(MEDIA / 'feature-code-memory.png', 'PNG', optimize=True)
    print("Saved media/feature-code-memory.png")


# -------------------------------------------------------------
# ASSET 3: Feature - Selection Transformations
# -------------------------------------------------------------
def create_feature_transformations():
    scale = 2
    w, h = 960 * scale, 560 * scale
    img = Image.new('RGBA', (w, h), (15, 23, 42, 255))
    draw = ImageDraw.Draw(img)

    pad = 20 * scale
    win_w = w - pad * 2
    win_h = h - pad * 2
    win_rect = (pad, pad, pad + win_w, pad + win_h)

    draw.rounded_rectangle(win_rect, radius=14 * scale, fill=(24, 24, 37, 255), outline=(51, 65, 85, 255), width=2 * scale)

    # Title Bar
    title_h = 44 * scale
    draw.rounded_rectangle((pad, pad, pad + win_w, pad + title_h), radius=14 * scale, fill=(30, 30, 46, 255))
    draw.rectangle((pad, pad + title_h - 10 * scale, pad + win_w, pad + title_h), fill=(30, 30, 46, 255))
    draw.line((pad, pad + title_h, pad + win_w, pad + title_h), fill=(51, 65, 85, 255), width=1 * scale)

    for i, c in enumerate([(239, 68, 68), (245, 158, 11), (16, 185, 129)]):
        draw.ellipse((pad + (20 + i * 22) * scale, pad + 16 * scale, pad + (32 + i * 22) * scale, pad + 28 * scale), fill=c)

    # Active Tab
    tab_x = pad + 100 * scale
    tab_w = 260 * scale
    draw.rounded_rectangle((tab_x, pad + 8 * scale, tab_x + tab_w, pad + title_h), radius=6 * scale, fill=(24, 24, 37, 255), outline=(51, 65, 85, 255), width=1 * scale)
    draw.line((tab_x + 1, pad + title_h, tab_x + tab_w - 1, pad + title_h), fill=(24, 24, 37, 255), width=2 * scale)
    draw.text((tab_x + 28 * scale, pad + 14 * scale), "transformDemo.ts", font=get_font('ui', 13 * scale), fill=(226, 232, 240, 255))
    draw.text((tab_x + 10 * scale, pad + 14 * scale), "TS", font=get_font('code_bold', 12 * scale), fill=(49, 120, 198, 255))

    # Side-by-side or Context Menu Presentation
    # Left column: Selection in editor
    col1_x = pad + 24 * scale
    col1_y = pad + title_h + 20 * scale
    col1_w = 420 * scale

    draw.text((col1_x, col1_y), "1. Selected Raw JSON Payload:", font=get_font('ui_bold', 13 * scale), fill="#94a3b8")

    box1_y = col1_y + 26 * scale
    box1_h = 240 * scale
    draw.rounded_rectangle((col1_x, box1_y, col1_x + col1_w, box1_y + box1_h), radius=8 * scale, fill=(30, 30, 46, 255), outline=(51, 65, 85, 255), width=1 * scale)
    
    # Selection highlight inside box 1
    draw.rectangle((col1_x + 8 * scale, box1_y + 8 * scale, col1_x + col1_w - 8 * scale, box1_y + box1_h - 8 * scale), fill=(38, 79, 120, 160))

    json_raw = [
        '{',
        '  "userId": "10492",',
        '  "userName": "alex_rivas",',
        '  "roles": ["admin", "dev"],',
        '  "tier": 2,',
        '  "isSubscribed": true',
        '}'
    ]
    for r_idx, r_line in enumerate(json_raw):
        draw.text((col1_x + 20 * scale, box1_y + (16 + r_idx * 26) * scale), r_line, font=get_font('code', 14 * scale), fill="#e2e8f0")

    # Middle / floating context popup: "Ctrl+Alt+Space"
    menu_x = col1_x + 160 * scale
    menu_y = box1_y + 40 * scale
    menu_w = 290 * scale
    menu_h = 220 * scale

    # Drop shadow
    shadow_offset = 6 * scale
    draw.rounded_rectangle((menu_x + shadow_offset, menu_y + shadow_offset, menu_x + menu_w + shadow_offset, menu_y + menu_h + shadow_offset), radius=8 * scale, fill=(10, 15, 29, 180))
    # Menu body
    draw.rounded_rectangle((menu_x, menu_y, menu_x + menu_w, menu_y + menu_h), radius=8 * scale, fill=(24, 24, 37, 255), outline=(45, 212, 191, 255), width=2 * scale)

    # Menu items
    m_items = [
        ("JSON → TypeScript Type", True),
        ("JSON ↔ JS Object Literal", False),
        ("Extract Keys / Values", False),
        ("Deduplicate Array Elements", False),
        ("Convert Case (camel, snake...)", False),
        ("Generate Data from Type", False),
    ]

    for m_idx, (m_title, is_active) in enumerate(m_items):
        item_y = menu_y + (m_idx * 36) * scale
        if is_active:
            draw.rectangle((menu_x + 2, item_y + 2, menu_x + menu_w - 2, item_y + 36 * scale), fill=(45, 75, 110, 255))
            draw_dragon(draw, menu_x + 10 * scale, item_y + 9 * scale, 18 * scale, fill="#2dd4bf")
            draw.text((menu_x + 36 * scale, item_y + 8 * scale), m_title, font=get_font('ui_bold', 12 * scale), fill="#ffffff")
        else:
            draw.text((menu_x + 36 * scale, item_y + 8 * scale), m_title, font=get_font('ui', 12 * scale), fill="#cbd5e1")

    # Right column: Transformed Result
    col2_x = col1_x + col1_w + 30 * scale
    col2_y = col1_y
    col2_w = 420 * scale

    draw.text((col2_x, col2_y), "2. Instant Transformed Output:", font=get_font('ui_bold', 13 * scale), fill="#2dd4bf")

    box2_y = col2_y + 26 * scale
    box2_h = box1_h
    draw.rounded_rectangle((col2_x, box2_y, col2_x + col2_w, box2_y + box2_h), radius=8 * scale, fill=(30, 30, 46, 255), outline=(45, 212, 191, 150), width=1 * scale)

    res_lines = [
        ("type ", "#ff7b72"), ("GeneratedUser ", "#ffa657"), ("= {", "#e2e8f0"),
        ("\n  userId: ", "#9cdcfe"), ("string", "#4ec9b0"), (";", "#e2e8f0"),
        ("\n  userName: ", "#9cdcfe"), ("string", "#4ec9b0"), (";", "#e2e8f0"),
        ("\n  roles: ", "#9cdcfe"), ("string[]", "#4ec9b0"), (";", "#e2e8f0"),
        ("\n  tier: ", "#9cdcfe"), ("number", "#4ec9b0"), (";", "#e2e8f0"),
        ("\n  isSubscribed: ", "#9cdcfe"), ("boolean", "#4ec9b0"), (";", "#e2e8f0"),
        ("\n};", "#e2e8f0")
    ]

    curr_x = col2_x + 20 * scale
    curr_y = box2_y + 16 * scale
    for token, color in res_lines:
        if token.startswith("\n"):
            curr_y += 26 * scale
            curr_x = col2_x + 20 * scale
            token = token[1:]
        draw.text((curr_x, curr_y), token, font=get_font('code', 14 * scale), fill=color)
        curr_x += draw.textlength(token, font=get_font('code', 14 * scale))

    # Bottom Pill callout
    pill_w = 340 * scale
    pill_h = 32 * scale
    pill_x = w - pad - pill_w - 16 * scale
    pill_y = h - pad - pill_h - 14 * scale
    draw.rounded_rectangle((pill_x, pill_y, pill_x + pill_w, pill_y + pill_h), radius=16 * scale, fill=(19, 78, 74, 255), outline=(45, 212, 191, 255), width=1 * scale)
    draw_dragon(draw, pill_x + 10 * scale, pill_y + 7 * scale, 18 * scale, fill="#2dd4bf")
    draw.text((pill_x + 36 * scale, pill_y + 7 * scale), "Zero-Friction In-Place Transformations", font=get_font('ui_bold', 12 * scale), fill="#ffffff")

    final_img = img.resize((960, 560), Image.Resampling.LANCZOS)
    final_img.save(MEDIA / 'feature-transformations.png', 'PNG', optimize=True)
    print("Saved media/feature-transformations.png")


# -------------------------------------------------------------
# ASSET 4: Feature - 100% Offline Architecture & Privacy
# -------------------------------------------------------------
def create_feature_architecture():
    scale = 2
    w, h = 960 * scale, 420 * scale
    img = Image.new('RGBA', (w, h), (15, 23, 42, 255))
    draw = ImageDraw.Draw(img)

    pad = 20 * scale
    win_w = w - pad * 2
    win_h = h - pad * 2
    win_rect = (pad, pad, pad + win_w, pad + win_h)

    draw.rounded_rectangle(win_rect, radius=14 * scale, fill=(24, 24, 37, 255), outline=(51, 65, 85, 255), width=2 * scale)

    # Header Bar
    head_y = pad + 18 * scale
    draw_dragon(draw, pad + 24 * scale, head_y, 28 * scale, fill="#2dd4bf")
    draw.text((pad + 60 * scale, head_y - 2 * scale), "100% Offline, Deterministic Architecture", font=get_font('ui_bold', 18 * scale), fill="#ffffff")
    draw.text((pad + 60 * scale, head_y + 22 * scale), "Complete local data isolation • Zero external network calls • No cloud subscriptions or API keys", font=get_font('ui', 12 * scale), fill="#94a3b8")

    # 3 Architecture Pillars
    pillar_y = pad + 80 * scale
    pillar_w = (win_w - 48 * scale - 32 * scale) / 3
    pillar_h = 190 * scale

    pillars = [
        ("VS Code Host", ["Cursor Listeners", "Selection Context", "TextDocument Events", "Native Undo Stack"], "#38bdf8"),
        ("Nihilanth Engine", ["Deterministic PRNG", "Fast TS/JSON Parser", "Slash Command Router", "Snippet Expander"], "#2dd4bf"),
        ("Atomic Local Storage", ["GlobalStorage JSON DB", "Multi-Window File Locks", "LRU Eviction (100MB)", "Pins Never Expire"], "#a78bfa"),
    ]

    for i, (title, items, accent) in enumerate(pillars):
        px = pad + 24 * scale + i * (pillar_w + 16 * scale)
        draw.rounded_rectangle((px, pillar_y, px + pillar_w, pillar_y + pillar_h), radius=10 * scale, fill=(30, 30, 46, 255), outline=accent, width=1 * scale)
        
        # Pill header
        draw.rounded_rectangle((px, pillar_y, px + pillar_w, pillar_y + 38 * scale), radius=10 * scale, fill=(15, 23, 42, 255))
        draw.rectangle((px, pillar_y + 24 * scale, px + pillar_w, pillar_y + 38 * scale), fill=(15, 23, 42, 255))
        draw.text((px + 14 * scale, pillar_y + 10 * scale), title, font=get_font('ui_bold', 13 * scale), fill=accent)

        for it_idx, item in enumerate(items):
            iy = pillar_y + (50 + it_idx * 30) * scale
            draw.ellipse((px + 16 * scale, iy + 6 * scale, px + 22 * scale, iy + 12 * scale), fill=accent)
            draw.text((px + 28 * scale, iy), item, font=get_font('ui', 12 * scale), fill="#e2e8f0")

    # Bottom Guarantees Badge Strip
    bot_y = pillar_y + pillar_h + 20 * scale
    bot_w = win_w - 48 * scale
    bot_h = 44 * scale
    bot_x = pad + 24 * scale

    draw.rounded_rectangle((bot_x, bot_y, bot_x + bot_w, bot_y + bot_h), radius=8 * scale, fill=(19, 78, 74, 180), outline=(45, 212, 191, 255), width=1 * scale)

    badges = [
        "✓ 0 KB Telemetry",
        "✓ 0 Network Requests",
        "✓ 0 Cloud Tokens",
        "✓ 100% Private to Your Machine"
    ]
    badge_spacing = bot_w / 4
    for b_idx, badge in enumerate(badges):
        draw.text((bot_x + 20 * scale + b_idx * badge_spacing, bot_y + 12 * scale), badge, font=get_font('ui_bold', 12 * scale), fill="#2dd4bf")

    final_img = img.resize((960, 420), Image.Resampling.LANCZOS)
    final_img.save(MEDIA / 'feature-architecture.png', 'PNG', optimize=True)
    print("Saved media/feature-architecture.png")


if __name__ == '__main__':
    create_feature_data_generation()
    create_feature_code_memory()
    create_feature_transformations()
    create_feature_architecture()
    print("All marketplace assets generated successfully.")
