/**
 * OCS Answer Server - 配置示例
 *
 * 使用方法：
 * 1. 启动服务器: npm run dev
 * 2. 访问 http://localhost:3000/api/ocs-config 获取配置JSON
 * 3. 将JSON配置复制到OCS的题库配置中
 *
 * 或者直接使用下面的配置：
 */

// ======= OCS题库配置 =======
// 复制以下JSON配置到OCS

/*
{
  "url": "http://localhost:3000/api/answer",
  "name": "LLM答案服务",
  "homepage": "http://localhost:3000/info",
  "method": "post",
  "contentType": "json",
  "type": "fetch",
  "headers": {
    "Content-Type": "application/json",
    "Accept": "application/json"
  },
  "data": {
    "title": "${title}",
    "type": "${type}",
    "options": "${options}"
  },
  "handler": "return (res) => res.code === 1 ? [res.question ?? undefined, res.answer] : [res.msg || '题库服务返回失败', undefined]"
}
*/

// ======= 如果需要跨域请求 =======
// 在脚本头部添加：
// // @connect localhost
// // @connect your-server-domain.com

// ======= 完整题库配置示例 =======
// defaultAnswerWrapperHandler(
//   {
//     title: '1+2,2+3',
//     type: 'single',
//     options: 'A. xxx\nB. xxx\nC. xxx\nD. xxx'
//   },
//   [
//     {
//       url: "http://localhost:3000/api/answer",
//       homepage: "http://localhost:3000/info",
//       method: "post",
//       contentType: "json",
//       type: "fetch",
//       headers: {
//         "Content-Type": "application/json",
//         "Accept": "application/json"
//       },
//       data: {
//         title: "${title}",
//         type: "${type}",
//         options: "${options}"
//       },
//       handler: "return (res) => res.code === 1 ? [res.question ?? undefined, res.answer] : [res.msg || '题库服务返回失败', undefined]"
//     }
//   ]
// );

// ======= 多选题配置 =======
// 对于多选题，handler需要处理答案分隔：
// handler: "return (res) => {
//   if (res.code === 1) {
//     return [res.question, res.answer];
//   }
//   return undefined;
// }"
// 注意：多选题答案会自动用#分隔

// ======= 题目类型说明 =======
// single    - 单选题
// multiple  - 多选题
// judgement - 判断题
// completion - 填空题

// ======= 特殊占位符说明 =======
// ${title}   - 题目标题
// ${type}    - 题目类型
// ${options} - 题目选项

// ======= 自定义data字段 =======
// data中的字段可以使用handler进行自定义解析
// 例如，根据题目类型发送不同的请求参数：
// data: {
//   type_id: {
//     handler: `return (env) => {
//       switch(env.type) {
//         case 'single': return 1;
//         case 'multiple': return 2;
//         case 'judgement': return 3;
//         case 'completion': return 4;
//         default: return 0;
//       }
//     }`
//   }
// }
