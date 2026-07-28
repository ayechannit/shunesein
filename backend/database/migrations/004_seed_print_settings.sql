-- Seeds the print page setup used by document printing (Purchase Orders,
-- Vouchers, Sale Orders, Invoices). Defaults to A4 with reasonable margins.
-- Safe to re-run - existing values are never overwritten.

INSERT INTO system_settings (key, value, description) VALUES
    ('print_margin_top', '15', 'Print page top margin in millimeters'),
    ('print_margin_bottom', '15', 'Print page bottom margin in millimeters'),
    ('print_margin_left', '10', 'Print page left margin in millimeters'),
    ('print_margin_right', '10', 'Print page right margin in millimeters'),
    ('print_page_width', '210', 'Print page width in millimeters (A4 = 210)'),
    ('print_page_height', '297', 'Print page height in millimeters (A4 = 297)')
ON CONFLICT (key) DO NOTHING;
