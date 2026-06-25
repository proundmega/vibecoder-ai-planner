const TemplateService = require('../services/TemplateService');
const Project = require('../models/project');
const { NotFoundError } = require('../errors/HttpError');

async function listTemplates(req, res, next) {
  try {
    const { id } = req.params;
    const project = await Project.findById(id);
    if (!project) throw new NotFoundError('Project not found');
    const templates = await TemplateService.list(id, req.user.userId);
    res.json({
      success: true,
      data: templates,
    });
  } catch (error) {
    next(error);
  }
}

async function createTemplate(req, res, next) {
  try {
    const { id } = req.params;
    const { name, description, file_definitions } = req.body;
    const project = await Project.findById(id);
    if (!project) throw new NotFoundError('Project not found');
    if (!name || !name.trim()) {
      throw new Error('Template name is required');
    }
    if (!file_definitions || !Array.isArray(file_definitions) || file_definitions.length === 0) {
      throw new Error('At least one file definition is required');
    }
    const template = await TemplateService.create(id, name.trim(), description, file_definitions, req.user.userId);
    res.status(201).json({
      success: true,
      data: template,
    });
  } catch (error) {
    next(error);
  }
}

async function deleteTemplate(req, res, next) {
  try {
    const { id: templateId } = req.params;
    const template = await TemplateService.delete(templateId, req.user.userId);
    if (!template) {
      throw new NotFoundError('Template not found or unauthorized');
    }
    res.json({
      success: true,
      data: template,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listTemplates,
  createTemplate,
  deleteTemplate,
};
