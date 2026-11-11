/**
 * 临时 Mock 后端 —— 用于端到端验证 knife4-doc 的解析与调试链路。
 * 同时模拟 springdoc 与 springfox 两套入口。
 */
import http from 'node:http'

const PORT = 9999

const openApi3User = {
  openapi: '3.0.3',
  info: {
    title: '用户中心服务 API',
    version: '1.4.2',
    description: '提供用户的创建、查询、更新与删除能力。\n\n> 所有接口均需要携带 `Authorization` 令牌。'
  },
  servers: [{ url: `http://127.0.0.1:${PORT}/api` }],
  tags: [
    { name: '用户管理', description: '用户的增删改查' },
    { name: '认证授权', description: '登录与令牌' }
  ],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
    },
    schemas: {
      Result: {
        type: 'object',
        properties: {
          code: { type: 'integer', format: 'int32', description: '业务状态码', example: 200 },
          message: { type: 'string', description: '提示信息', example: '操作成功' },
          data: { type: 'object', description: '业务数据', additionalProperties: true }
        },
        required: ['code', 'message']
      },
      User: {
        type: 'object',
        description: '用户实体',
        required: ['id', 'username', 'email'],
        properties: {
          id: { type: 'integer', format: 'int64', description: '用户 ID', example: 1001 },
          username: { type: 'string', description: '用户名', example: 'zhangsan' },
          email: { type: 'string', format: 'email', description: '邮箱', example: 'zhangsan@example.com' },
          status: {
            type: 'string',
            description: '账号状态',
            enum: ['ACTIVE', 'LOCKED', 'DISABLED'],
            example: 'ACTIVE'
          },
          age: { type: 'integer', description: '年龄', example: 28 },
          tags: { type: 'array', items: { type: 'string' }, description: '标签', example: ['vip'] },
          department: { $ref: '#/components/schemas/Department' },
          friends: { type: 'array', items: { $ref: '#/components/schemas/User' } }
        }
      },
      Department: {
        type: 'object',
        description: '部门',
        properties: {
          id: { type: 'integer', format: 'int64' },
          name: { type: 'string', description: '部门名称', example: '研发中心' },
          leader: { $ref: '#/components/schemas/User' }
        }
      }
    }
  },
  paths: {
    '/users': {
      get: {
        tags: ['用户管理'],
        summary: '分页查询用户',
        operationId: 'listUsersUsingGET',
        description: '支持按用户名模糊搜索、按状态过滤。',
        parameters: [
          { name: 'keyword', in: 'query', description: '用户名关键字', required: false, schema: { type: 'string' }, example: 'zhang' },
          { name: 'status', in: 'query', description: '账号状态', schema: { type: 'string', enum: ['ACTIVE', 'LOCKED', 'DISABLED'] } },
          { name: 'page', in: 'query', description: '页码', schema: { type: 'integer', default: 1 }, example: 1 },
          { name: 'size', in: 'query', description: '每页条数', schema: { type: 'integer', default: 20 }, example: 20 },
          { name: 'X-Trace-Id', in: 'header', description: '链路追踪 ID', schema: { type: 'string' } }
        ],
        responses: {
          200: {
            description: '查询成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    code: { type: 'integer', example: 200 },
                    message: { type: 'string', example: '操作成功' },
                    data: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer', example: 2 },
                        list: { type: 'array', items: { $ref: '#/components/schemas/User' } }
                      }
                    }
                  }
                }
              }
            }
          },
          401: { description: '未授权' }
        }
      },
      post: {
        tags: ['用户管理'],
        summary: '创建用户',
        operationId: 'createUserUsingPOST',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/User' }
            }
          }
        },
        responses: {
          200: {
            description: '创建成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } }
          },
          400: { description: '参数校验失败' }
        }
      }
    },
    '/users/{id}': {
      get: {
        tags: ['用户管理'],
        summary: '查询用户详情',
        operationId: 'getUserUsingGET',
        parameters: [
          { name: 'id', in: 'path', description: '用户 ID', required: true, schema: { type: 'integer', format: 'int64' } }
        ],
        responses: {
          200: {
            description: '查询成功',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
                example: { id: 1001, username: 'zhangsan', email: 'zhangsan@example.com', status: 'ACTIVE' }
              }
            }
          }
        }
      },
      put: {
        tags: ['用户管理'],
        summary: '更新用户',
        operationId: 'updateUserUsingPUT',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', format: 'int64' } }],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } }
        },
        responses: { 200: { description: '更新成功' } }
      },
      delete: {
        tags: ['用户管理'],
        summary: '删除用户',
        operationId: 'deleteUserUsingDELETE',
        deprecated: true,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', format: 'int64' } }],
        responses: { 204: { description: '删除成功' } }
      }
    },
    '/users/upload': {
      post: {
        tags: ['用户管理'],
        summary: '批量导入用户（文件上传）',
        operationId: 'uploadUsersUsingPOST',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary', description: 'Excel 文件' },
                  overwrite: { type: 'boolean', description: '是否覆盖已存在用户' }
                }
              }
            }
          }
        },
        responses: { 200: { description: '导入成功' } }
      }
    },
    '/auth/login': {
      post: {
        tags: ['认证授权'],
        summary: '用户登录',
        operationId: 'loginUsingPOST',
        requestBody: {
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string', description: '用户名' },
                  password: { type: 'string', description: '密码' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: '登录成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    expiresIn: { type: 'integer' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

const swagger2Doc = {
  swagger: '2.0',
  info: { title: '订单服务 API (Swagger 2.0)', version: '2.0.1', description: '用于验证 Swagger 2.0 解析链路' },
  host: `127.0.0.1:${PORT}`,
  basePath: '/order',
  schemes: ['http'],
  tags: [{ name: '订单' }, { name: '支付' }],
  definitions: {
    Order: {
      type: 'object',
      required: ['id', 'orderNo'],
      properties: {
        id: { type: 'integer', format: 'int64', description: '订单 ID' },
        orderNo: { type: 'string', description: '订单号' },
        amount: { type: 'number', format: 'double', description: '金额' },
        status: { type: 'string', enum: ['CREATED', 'PAID', 'CANCELLED'] },
        items: { type: 'array', items: { $ref: '#/definitions/OrderItem' } }
      }
    },
    OrderItem: {
      type: 'object',
      properties: {
        skuId: { type: 'integer' },
        quantity: { type: 'integer' },
        price: { type: 'number' }
      }
    }
  },
  paths: {
    '/orders': {
      get: {
        tags: ['订单'],
        summary: '订单列表',
        operationId: 'listOrders',
        produces: ['application/json'],
        parameters: [
          { name: 'orderNo', in: 'query', type: 'string', description: '订单号' },
          { name: 'page', in: 'query', type: 'integer', default: 1, description: '页码' }
        ],
        responses: {
          200: {
            description: 'OK',
            schema: { type: 'array', items: { $ref: '#/definitions/Order' } }
          }
        }
      },
      post: {
        tags: ['订单'],
        summary: '创建订单',
        operationId: 'createOrder',
        consumes: ['application/json'],
        parameters: [{ name: 'body', in: 'body', required: true, schema: { $ref: '#/definitions/Order' } }],
        responses: {
          200: { description: 'OK', schema: { $ref: '#/definitions/Order' } }
        }
      }
    },
    '/orders/{id}/pay': {
      post: {
        tags: ['支付'],
        summary: '订单支付',
        operationId: 'payOrder',
        consumes: ['application/x-www-form-urlencoded'],
        parameters: [
          { name: 'id', in: 'path', required: true, type: 'integer' },
          { name: 'channel', in: 'formData', required: true, type: 'string', enum: ['ALIPAY', 'WECHAT'], description: '支付渠道' },
          { name: 'amount', in: 'formData', type: 'number', description: '支付金额' }
        ],
        responses: { 200: { description: 'OK', schema: { type: 'boolean' } } }
      }
    }
  }
}

function send(res, status, data, origin = '*') {
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  res.writeHead(status, {
    'Content-Type': 'application/json;charset=UTF-8',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS,HEAD',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const path = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS,HEAD'
    })
    res.end()
    return
  }

  // ---- 文档入口 ----------------------------------------------------------
  if (path === '/v3/api-docs/swagger-config') {
    return send(res, 200, {
      configUrl: '/v3/api-docs/swagger-config',
      urls: [
        { name: 'default', url: `http://127.0.0.1:${PORT}/v3/api-docs/default` },
        { name: 'user-service', url: `http://127.0.0.1:${PORT}/v3/api-docs/user-service` }
      ],
      'urls.primaryName': 'default'
    })
  }

  if (path === '/swagger-resources') {
    return send(res, 200, [
      { name: 'order-service', url: `http://127.0.0.1:${PORT}/v2/api-docs`, swaggerVersion: '2.0', location: `http://127.0.0.1:${PORT}/v2/api-docs` }
    ])
  }

  if (path === '/v3/api-docs/default' || path === '/v3/api-docs') {
    return send(res, 200, openApi3User)
  }

  if (path === '/v3/api-docs/user-service') {
    return send(res, 200, {
      ...openApi3User,
      info: { ...openApi3User.info, title: '用户中心服务 API（user-service 分组）' }
    })
  }

  if (path === '/v2/api-docs') {
    return send(res, 200, swagger2Doc)
  }

  // ---- 业务回显接口 -----------------------------------------------------
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    send(res, 200, {
      echo: {
        method: req.method,
        path,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: req.headers,
        body: raw || null,
        receivedAt: new Date().toISOString()
      }
    })
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] listening on http://127.0.0.1:${PORT}`)
})
