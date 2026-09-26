// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * The shapes the API returns, as OpenAPI schemas.
 *
 * Hand-written rather than generated: the responses are assembled by hand in
 * the controllers too, so a generator would have nothing truthful to read. The
 * drift test in tests/openapi.test.js is what keeps this honest — it walks the
 * live Express router and fails when a route has no documentation, or a
 * documented path no longer exists.
 */

const Link = {
  type: 'object',
  description: 'A card on the page. Either points at a URL or carries an attached file.',
  properties: {
    id:          { type: 'integer', example: 12 },
    name:        { type: 'string',  example: 'Payroll portal' },
    url:         {
      type: 'string',
      description: 'The destination. For a file-backed link this mirrors `file_path`, '
                 + 'so `/r/{id}` always has one uniform target.',
      example: 'https://hr.example.com/payroll',
    },
    slug: {
      type: 'string', nullable: true,
      description: 'Optional custom URL. When set the link also answers at `/f/{slug}`.',
      example: 'payroll',
    },
    description: { type: 'string', nullable: true },
    image_path:  { type: 'string', nullable: true, description: 'Custom icon, owned by the icon library.' },
    favicon_path:{ type: 'string', nullable: true, description: 'Icon fetched from the target site.' },
    file_path:   { type: 'string', nullable: true, description: 'Attached file, when the link carries one.' },
    file_name:   { type: 'string', nullable: true, example: 'handbook.pdf' },
    position:    { type: 'integer' },
    is_hidden:   { type: 'integer', enum: [0, 1], description: 'Hidden links are admin-only.' },
    auto_open:   {
      type: 'integer', enum: [0, 1],
      description: 'A markdown link that opens itself when its group is opened '
                 + 'on the public page. Only markdown links may carry it.',
    },
    is_broken:   { type: 'integer', enum: [0, 1], description: 'Last health check failed.' },
    created_at:  { type: 'string', format: 'date-time' },
    group_ids:   { type: 'array', items: { type: 'integer' } },
    groups:      { type: 'array', items: { $ref: '#/components/schemas/LinkGroupMembership' } },
  },
};

const LinkGroupMembership = {
  type: 'object',
  description: 'A group a link belongs to, and the section within it.',
  properties: {
    id:                  { type: 'integer' },
    name:                { type: 'string' },
    color:               { type: 'string', example: '#0071e3' },
    section_id:          { type: 'integer', nullable: true },
    section_name:        { type: 'string',  nullable: true },
    parent_section_id:   { type: 'integer', nullable: true },
    parent_section_name: { type: 'string',  nullable: true },
  },
};

const Group = {
  type: 'object',
  properties: {
    id:           { type: 'integer' },
    name:         { type: 'string', example: 'Finance' },
    color:        { type: 'string', example: '#0071e3' },
    position:     { type: 'integer' },
    is_protected: { type: 'boolean', description: 'Password-protected; its links need an unlock.' },
    unlock_mode:  { type: 'string', enum: ['session', 'persistent'] },
    sections:     { type: 'array', items: { $ref: '#/components/schemas/Section' } },
  },
};

const Section = {
  type: 'object',
  description: 'A heading inside a group. One level of nesting is allowed.',
  properties: {
    id:                { type: 'integer' },
    group_id:          { type: 'integer' },
    name:              { type: 'string', example: 'Policies' },
    position:          { type: 'integer' },
    parent_section_id: { type: 'integer', nullable: true },
    subsections:       { type: 'array', items: { type: 'object' } },
  },
};

const Icon = {
  type: 'object',
  description: 'An image in the shared icon library, which owns its file on disk.',
  properties: {
    id:            { type: 'integer' },
    file_path:     { type: 'string', example: '/uploads/1790-ab12.png' },
    original_name: { type: 'string', nullable: true },
    mime_type:     { type: 'string', nullable: true },
    file_size:     { type: 'integer', nullable: true },
    created_at:    { type: 'string', format: 'date-time' },
    last_used_at:  { type: 'string', format: 'date-time', nullable: true },
  },
};

const LinkRequest = {
  type: 'object',
  description: 'Something a visitor asked for: a new link, a file to publish, '
             + 'or a change to a link that already exists.',
  properties: {
    id:   { type: 'integer' },
    kind: {
      type: 'string', enum: ['link', 'file', 'change'],
      description: '`link` proposes a URL, `file` carries an upload, `change` proposes '
                 + 'new values for `target_link_id`.',
    },
    name:           { type: 'string' },
    url:            { type: 'string', description: 'Empty for a file request.' },
    description:    { type: 'string', nullable: true },
    note:           { type: 'string', nullable: true, description: 'Why the change was proposed.' },
    image_path:     { type: 'string', nullable: true },
    icon_id:        { type: 'integer', nullable: true },
    file_path:      { type: 'string', nullable: true, description: 'The visitor\'s upload.' },
    file_name:      { type: 'string', nullable: true },
    file_size:      { type: 'integer', nullable: true },
    target_link_id: { type: 'integer', nullable: true },
    target_name:        { type: 'string', nullable: true, description: 'Current value, for the diff.' },
    target_url:         { type: 'string', nullable: true },
    target_description: { type: 'string', nullable: true },
    target_file_name:   { type: 'string', nullable: true },
    group_id:       { type: 'integer', nullable: true },
    group_name:     { type: 'string',  nullable: true },
    group_color:    { type: 'string',  nullable: true },
    section_id:     { type: 'integer', nullable: true },
    section_name:   { type: 'string',  nullable: true },
    status:         { type: 'string', enum: ['pending', 'approved', 'rejected'] },
    ip_address:     { type: 'string', nullable: true },
    created_at:     { type: 'string', format: 'date-time' },
    reviewed_at:    { type: 'string', format: 'date-time', nullable: true },
    created_link_id:{ type: 'integer', nullable: true },
    existing_link:  {
      type: 'object', nullable: true,
      description: 'Set when a link with this URL is already published.',
    },
  },
};

const Settings = {
  type: 'object',
  description: 'Public settings. Readable without a token: the page needs them to render.',
  properties: {
    logo_light:               { type: 'string', nullable: true },
    logo_dark:                { type: 'string', nullable: true },
    favicon:                  { type: 'string', nullable: true },
    site_title:               { type: 'string', nullable: true },
    brand_icon:               { type: 'string', nullable: true },
    public_password_required: { type: 'boolean' },
    pinned_group_id:          { type: 'integer', nullable: true },
    save_favicons_to_library: { type: 'boolean' },
    requests_enabled:         { type: 'boolean' },
    request_password_required:{ type: 'boolean' },
    accent_color:             { type: 'string', nullable: true },
    accent_dark_adjust:       { type: 'boolean' },
    accent_glow:              { type: 'boolean' },
    mobile_nav_position:      { type: 'string', enum: ['top', 'bottom'] },
    theme_light_variant:      { type: 'string' },
    theme_dark_variant:       { type: 'string' },
    default_theme:            { type: 'string', enum: ['light', 'dark', 'system'] },
    footer_enabled:           { type: 'boolean' },
    group_tab_color:          { type: 'boolean' },
    group_tabs_loop:          { type: 'boolean' },
    markdown_open_mode:       {
      type: 'string', enum: ['tab', 'modal'],
      description: 'Where a markdown link opens on the public page.',
    },
    wallpaper_light:          { type: 'string', nullable: true },
    wallpaper_dark:           { type: 'string', nullable: true },
    wallpaper_fog:            {
      type: 'integer', minimum: 0, maximum: 100,
      description: 'How heavily the wallpaper is veiled and blurred.',
    },
    bar_opacity:              {
      type: 'integer', minimum: 0, maximum: 100,
      description: 'How solid the header, tab strip and footer are, from '
                 + 'completely see-through to flat colour.',
    },
  },
};

const AuditEntry = {
  type: 'object',
  properties: {
    id:          { type: 'integer' },
    action:      { type: 'string', example: 'link.update' },
    entity_type: { type: 'string', example: 'link' },
    entity_id:   { type: 'integer', nullable: true },
    summary:     { type: 'string' },
    ip_address:  { type: 'string', nullable: true },
    user_agent:  { type: 'string', nullable: true },
    created_at:  { type: 'string', format: 'date-time' },
  },
};

const LinkStats = {
  type: 'object',
  properties: {
    link_id:         { type: 'integer' },
    total_clicks:    { type: 'integer' },
    unique_visitors: { type: 'integer' },
    clicks_today:    { type: 'integer' },
    clicks_this_week:{ type: 'integer' },
  },
};

const IpTag = {
  type: 'object',
  description: 'A human-readable name for an IP, so clicks can be attributed.',
  properties: {
    ip_address: { type: 'string', example: '203.0.113.9' },
    tag:        { type: 'string', example: 'Reception desk' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const Error = {
  type: 'object',
  properties: { error: { type: 'string', example: 'Name is required' } },
};

const GroupAssignment = {
  type: 'string',
  description: 'JSON array of `{ group_id, section_id }`, sent as a form field.',
  example: '[{"group_id":3,"section_id":null}]',
};

module.exports = {
  Link, LinkGroupMembership, Group, Section, Icon, LinkRequest,
  Settings, AuditEntry, LinkStats, IpTag, Error, GroupAssignment,
};
